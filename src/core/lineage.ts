import { existsSync, readdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import type { Stage, Finding, AuthorResponse } from "./types.js";
import { UsageError } from "./errors.js";
import { readRound, listRounds } from "./persistence.js";
import { sha256OfFile } from "./hash.js";
import { readResponses, sidecarPathFor, validateResponses } from "./responses.js";

export interface LineageSelection {
  lineageId: string; round: number;
  parentRoundSha256: string | null; parentResponsesSha256: string | null;
  priorFindings: Finding[]; priorResponses: AuthorResponse[];
}

function reviewDirHasRounds(reviewDir: string): boolean {
  if (!existsSync(reviewDir)) return false;
  for (const name of readdirSync(reviewDir)) {
    if (listRounds(join(reviewDir, name)).length > 0) return true;
  }
  return false;
}

export async function selectLineage(args: {
  reviewDir: string; priorLogPath?: string; newLineage: boolean;
  stage: Stage; criteriaSha256: string; priorDocumentSha256: string | null;
  mintLineageId: () => string;
}): Promise<LineageSelection> {
  if (args.newLineage && args.priorLogPath)
    throw new UsageError("--new-lineage cannot be combined with --prior-log");

  if (args.priorLogPath) {
    const path = args.priorLogPath;
    if (!existsSync(path)) throw new UsageError(`--prior-log not found: ${path}`);
    const lineageDir = dirname(path);
    const lineageId = basename(lineageDir);
    const prior = readRound(path);
    // Trust the validated round number from the artifact, not a regex on the filename (a renamed
    // file would yield NaN and a misleading error). Require the file to be named for its round so
    // listRounds / parent-path construction stay coherent.
    const priorNum = prior.round;
    if (basename(path) !== `round-${priorNum}.json`)
      throw new UsageError(`--prior-log must be named round-${priorNum}.json (matching its round field), got ${basename(path)}`);
    const rounds = listRounds(lineageDir);
    const latest = rounds[rounds.length - 1];
    if (priorNum !== latest)
      throw new UsageError(`--prior-log is not the latest round in its lineage (round ${priorNum}, latest ${latest})`);
    if (prior.stage !== args.stage) throw new UsageError(`--prior-log stage ${prior.stage} != ${args.stage}`);
    if (prior.criteria_sha256 !== args.criteriaSha256) throw new UsageError("--prior-log criteria hash differs");
    if (prior.prior_document_sha256 !== args.priorDocumentSha256) throw new UsageError("--prior-log prior-document hash differs");
    const sidecar = sidecarPathFor(path);
    if (!existsSync(sidecar)) throw new UsageError(`--prior-log responses sidecar is not finalized: ${sidecar}`);
    const responses = readResponses(sidecar);   // validates the sidecar envelope shape
    if (responses.finalized !== true) throw new UsageError("--prior-log responses sidecar is not finalized");
    // Re-bind the sidecar to THIS round: its recorded round hash, round number, and lineage
    // must match the round it claims to answer, and its responses must still validate against
    // that round's result. Catches a stale/swapped/edited sidecar before its findings are reused.
    const roundHash = await sha256OfFile(path);
    if (responses.round_sha256 !== roundHash)
      throw new UsageError("--prior-log sidecar round_sha256 does not match its round (stale or mismatched sidecar)");
    if (responses.round !== priorNum || responses.lineageId !== lineageId)
      throw new UsageError(`--prior-log sidecar identity (round ${responses.round}/${responses.lineageId}) does not match round ${priorNum}/${lineageId}`);
    const recheck = validateResponses(responses.responses, prior.result);
    if (!recheck.ok) throw new UsageError(`--prior-log sidecar fails revalidation against its round: ${recheck.errors}`);
    // Re-verify the selected round's IMMEDIATE parent pair against the on-disk round-(N-1)
    // files (frozen v1: immediate only — not the whole chain). The round stored these hashes
    // when it was created; if round-(N-1) or its sidecar was since corrupted/replaced, the
    // recorded hash no longer matches and we refuse to build on a broken lineage.
    if (prior.parent_round_sha256 !== null) {
      const parentPath = join(lineageDir, `round-${priorNum - 1}.json`);
      if (!existsSync(parentPath))
        throw new UsageError(`--prior-log round ${priorNum} references a missing parent round-${priorNum - 1}.json`);
      if (await sha256OfFile(parentPath) !== prior.parent_round_sha256)
        throw new UsageError(`--prior-log round ${priorNum} parent_round_sha256 does not match round-${priorNum - 1}.json on disk`);
      if (prior.parent_responses_sha256 !== null) {
        const parentSidecar = sidecarPathFor(parentPath);
        if (!existsSync(parentSidecar))
          throw new UsageError(`--prior-log round ${priorNum} references a missing parent sidecar round-${priorNum - 1}.responses.json`);
        if (await sha256OfFile(parentSidecar) !== prior.parent_responses_sha256)
          throw new UsageError(`--prior-log round ${priorNum} parent_responses_sha256 does not match round-${priorNum - 1}.responses.json on disk`);
      }
    }
    return {
      lineageId, round: priorNum + 1,
      parentRoundSha256: roundHash,
      parentResponsesSha256: await sha256OfFile(sidecar),
      priorFindings: prior.result.findings,
      priorResponses: responses.responses
    };
  }

  if (args.newLineage)
    return { lineageId: args.mintLineageId(), round: 1, parentRoundSha256: null, parentResponsesSha256: null, priorFindings: [], priorResponses: [] };

  if (reviewDirHasRounds(args.reviewDir))
    throw new UsageError("Rounds already exist; pass --prior-log <latest round> or --new-lineage");

  return { lineageId: args.mintLineageId(), round: 1, parentRoundSha256: null, parentResponsesSha256: null, priorFindings: [], priorResponses: [] };
}
