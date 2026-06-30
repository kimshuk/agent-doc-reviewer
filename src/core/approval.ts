import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./errors.js";
import { readRound, listRounds, type RoundArtifact } from "./persistence.js";
import { validateStructural } from "./schema.js";
import { validateSemantic } from "./semantics.js";
import { computeVerdict } from "./verdict.js";
import { sha256OfFile } from "./hash.js";

// Deterministic auto-locate (spec §6 step 0): only approved stage:spec rounds whose
// document_sha256 matches --prior; highest round WITHIN a lineage; >1 qualifying lineage is
// ambiguous (require --prior-approval) rather than picking by round number across lineages.
function findApprovedFor(reviewDir: string, priorHash: string): string {
  if (!existsSync(reviewDir)) throw new UsageError(`No review dir for --prior approval: ${reviewDir}`);
  const perLineage: Array<{ path: string; round: number }> = [];
  for (const lineage of readdirSync(reviewDir)) {
    const lineageDir = join(reviewDir, lineage);
    let best: { path: string; round: number } | undefined;
    for (const n of listRounds(lineageDir)) {
      const path = join(lineageDir, `round-${n}.json`);
      let art: RoundArtifact;
      try { art = readRound(path); } catch { continue; }   // skip malformed/unreadable — never trusted
      if (art.verdict !== "approved" || art.stage !== "spec" || art.document_sha256 !== priorHash) continue;
      if (!best || n > best.round) best = { path, round: n };
    }
    if (best) perLineage.push(best);
  }
  if (perLineage.length === 0)
    throw new UsageError(`No approved spec round matching --prior found under ${reviewDir}`);
  if (perLineage.length > 1)
    throw new UsageError(`Ambiguous approval: ${perLineage.length} lineages have an approved round for --prior; pass --prior-approval to choose one`);
  return perLineage[0].path;
}

export async function verifyApproval(args: {
  approvalPath?: string; priorPath: string; priorReviewDir: string;
}): Promise<{ approvalSha256: string }> {
  const priorHash = await sha256OfFile(args.priorPath);
  const path = args.approvalPath ?? findApprovedFor(args.priorReviewDir, priorHash);

  // readRound validates the full envelope (schema §6); a malformed artifact throws here.
  let artifact: RoundArtifact;
  try { artifact = readRound(path); } catch (err) { throw new UsageError(`Cannot read approval artifact: ${path} (${(err as Error).message})`); }

  const structural = validateStructural(artifact.result);
  if (!structural.ok) throw new UsageError(`Approval artifact result is malformed: ${structural.errors}`);

  const semantic = validateSemantic(artifact.result, {
    stage: "spec", mode: "within_result", criteriaMeta: artifact.criteriaMeta,
    requirementIds: [], priorFindings: [], inputLineCounts: {}
  });
  if (!semantic.ok) throw new UsageError(`Approval artifact failed within-result checks: ${semantic.errors}`);

  const recomputed = computeVerdict(artifact.result, artifact.criteriaMeta);
  if (recomputed !== "approved" || artifact.verdict !== "approved")
    throw new UsageError(`Approval artifact is not a valid approved round (stored=${artifact.verdict}, recomputed=${recomputed})`);

  if (artifact.stage !== "spec") throw new UsageError(`Approval artifact stage is ${artifact.stage}, expected spec`);

  // priorHash computed above; an explicit --prior-approval is re-checked here too.
  if (artifact.document_sha256 !== priorHash)
    throw new UsageError("Approval artifact document hash does not match --prior");

  return { approvalSha256: await sha256OfFile(path) };
}
