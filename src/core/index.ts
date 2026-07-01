import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  Stage, Identity, ReviewerProvider, ReviewResult, Verdict, Finding, AuthorResponse, CriteriaMeta
} from "./types.js";
import { sha256 } from "./hash.js";
import { renderLineNumbered, lineCount } from "./render.js";
import { parseCriteria, parseRequirements } from "./criteria.js";
import { assertCrossModel } from "./identity.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { runReview } from "./review.js";
import { selectLineage } from "./lineage.js";
import { writeRoundOnce, type RoundArtifact } from "./persistence.js";
import { verifyApproval } from "./approval.js";
import { UsageError } from "./errors.js";
import type { SemanticContext } from "./semantics.js";

export interface ReviewOnceInput {
  docPath: string;
  stage: Stage;                                   // Phase 1 uses "spec" only
  criteriaPath: string;
  reviewer: { provider: ReviewerProvider; model: string };
  reviewerIdentity: Identity;
  author: Identity;
  allowSameModel: boolean;
  prior?: {                                       // plan-stage upstream; undefined in Phase 1
    path: string;                                 // identifier; the `where.path` a finding cites
    text: string;                                 // RAW prior spec — reviewOnce renders + counts it
    requirementIds: string[];                     // [REQ-*]
  };
  priorFindings: Finding[];                        // carried active findings; [] in Phase 1
  priorResponses: AuthorResponse[];                // author responses to priors; [] in Phase 1
}

export interface ReviewInputs {
  system: string;
  user: string;
  ctx: SemanticContext;
  criteriaMeta: CriteriaMeta;
}

// Shared assembly: read doc + criteria (+ optional prior), build the constant prompts and the
// SemanticContext. Reused by reviewOnce AND the CLI's compare path (Task 20) so the read/parse/
// render logic lives in exactly one place. Stateless; reads files, writes nothing.
export async function buildReviewInputs(args: {
  docPath: string; stage: Stage; criteriaPath: string;
  prior?: { path: string; text: string; requirementIds: string[] };
  priorFindings: Finding[]; priorResponses: AuthorResponse[];
}): Promise<ReviewInputs> {
  const docText = await readFile(args.docPath, "utf8");
  const criteriaText = await readFile(args.criteriaPath, "utf8");
  const { ids: criterionIds, meta: criteriaMeta } = parseCriteria(criteriaText);

  const inputLineCounts: Record<string, number> = { [args.docPath]: lineCount(docText) };
  let priorRendered: string | undefined;
  let requirementIds: string[] = [];
  if (args.prior) {
    requirementIds = args.prior.requirementIds;
    priorRendered = renderLineNumbered(args.prior.text);
    inputLineCounts[args.prior.path] = lineCount(args.prior.text);
  }

  const system = buildSystemPrompt(args.stage);
  const user = buildUserPrompt({
    documentPath: args.docPath, documentRendered: renderLineNumbered(docText),
    criteriaMarkdown: criteriaText, expectedCriterionIds: criterionIds, expectedRequirementIds: requirementIds,
    priorSpecPath: args.prior?.path, priorSpecRendered: priorRendered,
    priorFindings: args.priorFindings, priorResponses: args.priorResponses
  });

  const ctx: SemanticContext = {
    stage: args.stage, mode: "full", criteriaMeta, requirementIds,
    priorFindings: args.priorFindings, inputLineCounts
  };

  return { system, user, ctx, criteriaMeta };
}

export async function reviewOnce(
  input: ReviewOnceInput
): Promise<{ verdict: Verdict; result: ReviewResult }> {
  assertCrossModel(input.author, input.reviewerIdentity, input.allowSameModel);
  const { system, user, ctx, criteriaMeta } = await buildReviewInputs(input);
  return runReview({
    provider: input.reviewer.provider, system, user, model: input.reviewer.model, ctx, criteriaMeta
  });
}

// ── Phase 2: persisting orchestrator ────────────────────────────────────────
// Frozen contract (docs/.../phase-2-iteration-and-artifacts.md): the input type fixes Phase 3's
// plan-stage fields as RESERVED. Phase 2 supports stage:"spec" only and calls the FROZEN reviewOnce;
// it never edits reviewOnce. Phase 3 activates priorPath/priorApprovalPath/stage:"plan" by adding
// the plan branch (verifyApproval + requirementIds + prior passthrough) with no signature change.
export interface ReviewDocumentInput {
  docPath: string;
  stage: Stage;                                   // Phase 2 supports "spec" only
  criteriaPath: string;
  reviewer: { provider: ReviewerProvider; model: string };
  reviewerIdentity: Identity;
  author: Identity;
  allowSameModel: boolean;
  priorLogPath?: string;                          // lineage continuation (Phase 2)
  newLineage: boolean;
  outDir?: string;
  // ── reserved for Phase 3 (plan stage); UNSUPPORTED in Phase 2 ──
  priorPath?: string;                             // approved upstream spec
  priorApprovalPath?: string;                     // its approval artifact
  now: () => string;
  mintLineageId: () => string;
}

// reviewDocument layers persistence + lineage on top of the frozen reviewOnce: it resolves priors
// from the lineage and passes them through reviewOnce's already-defined priorFindings/priorResponses
// fields, then writes the immutable round artifact and returns its path.
export async function reviewDocument(
  input: ReviewDocumentInput
): Promise<{ verdict: Verdict; result: ReviewResult; roundPath: string }> {
  // Stage-aware validation.
  if (input.stage === "spec") {
    if (input.priorPath !== undefined || input.priorApprovalPath !== undefined)
      throw new UsageError("--prior/--prior-approval are only valid with --stage plan");
  } else if (input.stage === "plan") {
    if (input.priorPath === undefined)
      throw new UsageError("--stage plan requires --prior <approved upstream spec>");
  } else {
    throw new UsageError(`unknown stage: ${input.stage}`);
  }

  const criteriaText = await readFile(input.criteriaPath, "utf8");
  const docText = await readFile(input.docPath, "utf8");
  const { meta: criteriaMeta } = parseCriteria(criteriaText);
  const criteriaSha256 = sha256(criteriaText);

  // Resolve the upstream prior (plan stage only); spec defaults stay undefined / null / [].
  let prior: { path: string; text: string; requirementIds: string[] } | undefined;
  let priorDocumentSha256: string | null = null;
  let priorApprovalSha256: string | null = null;
  let requirementIds: string[] = [];
  if (input.stage === "plan") {
    const priorPath = input.priorPath!;                 // guaranteed by the guard above
    const priorText = await readFile(priorPath, "utf8");
    const priorReviewDir = `${priorPath}.review`;        // same convention reviewDocument uses for outDir
    const { approvalSha256 } = await verifyApproval({
      approvalPath: input.priorApprovalPath, priorPath, priorReviewDir
    });
    requirementIds = parseRequirements(priorText);       // throws if the prior has no [REQ-*]
    prior = { path: priorPath, text: priorText, requirementIds };
    priorDocumentSha256 = sha256(priorText);
    priorApprovalSha256 = approvalSha256;
  }

  // A continuation MUST be written into the same review dir that holds its prior-log lineage,
  // otherwise round N+1 lands in a different tree than round N (writeRoundOnce uses reviewDir +
  // lineageId) and the lineage splits — a later parent re-verification then can't find round N.
  // The prior-log path is <reviewDir>/<lineageId>/round-N.json, so its reviewDir is two levels up.
  let reviewDir = input.outDir ?? `${input.docPath}.review`;
  if (input.priorLogPath) {
    const priorReviewDir = dirname(dirname(input.priorLogPath));
    if (input.outDir !== undefined && resolve(input.outDir) !== resolve(priorReviewDir))
      throw new UsageError("--out must match the --prior-log lineage directory (or be omitted on a continuation)");
    reviewDir = priorReviewDir;
  }

  const lineage = await selectLineage({
    reviewDir, priorLogPath: input.priorLogPath, newLineage: input.newLineage,
    stage: input.stage, criteriaSha256, priorDocumentSha256, mintLineageId: input.mintLineageId
  });

  // Call the FROZEN reviewOnce (it re-reads doc/criteria + runs assertCrossModel internally).
  const { verdict, result } = await reviewOnce({
    docPath: input.docPath, stage: input.stage, criteriaPath: input.criteriaPath,
    reviewer: input.reviewer, reviewerIdentity: input.reviewerIdentity,
    author: input.author, allowSameModel: input.allowSameModel,
    prior,
    priorFindings: lineage.priorFindings, priorResponses: lineage.priorResponses
  });

  const artifact: RoundArtifact = {
    schemaVersion: 1, round: lineage.round, lineageId: lineage.lineageId, timestamp: input.now(),
    stage: input.stage, author: input.author, reviewer: input.reviewerIdentity,
    document_sha256: sha256(docText), criteria_sha256: criteriaSha256,
    prior_document_sha256: priorDocumentSha256,
    parent_round_sha256: lineage.parentRoundSha256, parent_responses_sha256: lineage.parentResponsesSha256,
    prior_approval_sha256: priorApprovalSha256, criteriaMeta, requirementIds, verdict, result
  };
  const roundPath = writeRoundOnce(reviewDir, lineage.lineageId, lineage.round, artifact);
  return { verdict, result, roundPath };
}

// --- public barrel ---
export * from "./types.js";
export { selectProvider } from "./providers/registry.js";
export { assertCrossModel } from "./identity.js";
export { parseCriteria, parseRequirements, extractRequirementIds } from "./criteria.js";
export { generateCriteriaDraft, assembleCriteriaMarkdown } from "./criteriaInit.js";
export { runCompare } from "./compare.js";
export { finalizeResponses, validateResponses, readResponses, sidecarPathFor } from "./responses.js";
export { UsageError, ValidationError } from "./errors.js";
