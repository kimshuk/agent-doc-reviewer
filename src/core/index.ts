import { readFile } from "node:fs/promises";
import type {
  Stage, Identity, ReviewerProvider, ReviewResult, Verdict, Finding, AuthorResponse, CriteriaMeta
} from "./types.js";
import { renderLineNumbered, lineCount } from "./render.js";
import { parseCriteria } from "./criteria.js";
import { assertCrossModel } from "./identity.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { runReview } from "./review.js";
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

// --- Phase-1 public barrel (only what Phase 1 ships) ---
export * from "./types.js";
export { selectProvider } from "./providers/registry.js";
export { assertCrossModel } from "./identity.js";
export { parseCriteria, parseRequirements } from "./criteria.js";
export { runCompare } from "./compare.js";
export { UsageError, ValidationError } from "./errors.js";
