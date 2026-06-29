import { writeFileSync, readFileSync, linkSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AuthorResponse, ReviewResult, Finding } from "./types.js";
import { UsageError } from "./errors.js";
import { sha256OfFile } from "./hash.js";
import { readRound } from "./persistence.js";
import { validateResponsesArtifact } from "./schema.js";

export interface ResponsesArtifact {
  round: number; lineageId: string; round_sha256: string; finalized: true; responses: AuthorResponse[];
}

const isActive = (f: Finding) => f.status === "new" || f.status === "still_present";
const NEEDS_EVIDENCE = new Set(["rejected_with_evidence", "already_addressed"]);

export function sidecarPathFor(roundPath: string): string {
  return roundPath.replace(/\.json$/, ".responses.json");
}

export function validateResponses(
  responses: AuthorResponse[], result: ReviewResult
): { ok: true } | { ok: false; errors: string } {
  const errs: string[] = [];
  const active = new Set(result.findings.filter(isActive).map(f => f.id));
  const allById = new Map(result.findings.map(f => [f.id, f]));
  const seen = new Set<string>();
  for (const r of responses) {
    if (!allById.has(r.findingId)) errs.push(`response for unknown finding ${r.findingId}`);
    else if (!active.has(r.findingId)) errs.push(`response for terminal finding ${r.findingId} (none allowed)`);
    if (seen.has(r.findingId)) errs.push(`duplicate response for ${r.findingId}`);
    seen.add(r.findingId);
    if (NEEDS_EVIDENCE.has(r.response) && !(r.evidence && r.evidence.trim()))
      errs.push(`response ${r.response} for ${r.findingId} requires non-empty evidence`);
  }
  for (const id of active) if (!seen.has(id)) errs.push(`missing response for active finding ${id}`);
  return errs.length ? { ok: false, errors: errs.join("; ") } : { ok: true };
}

export async function finalizeResponses(roundPath: string, responses: AuthorResponse[]): Promise<string> {
  const round = readRound(roundPath);
  const check = validateResponses(responses, round.result);
  if (!check.ok) throw new UsageError(`Invalid author responses: ${check.errors}`);
  const sidecar = sidecarPathFor(roundPath);
  const artifact: ResponsesArtifact = {
    round: round.round, lineageId: round.lineageId,
    round_sha256: await sha256OfFile(roundPath), finalized: true, responses
  };
  // Atomic, no-clobber publish: write a temp file, then hard-link it to the sidecar.
  // linkSync throws EEXIST if the sidecar already exists, so an existing file is NEVER overwritten.
  // Unique temp name beside the sidecar (same filesystem, so linkSync won't EXDEV). Uses
  // crypto.randomUUID — NOT process.pid — so core stays free of the `process` global (REQ-CORE).
  // The temp file is ephemeral (unlinked in finally), so its non-deterministic name is unobservable.
  const tmp = `${sidecar}.tmp-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(artifact, null, 2) + "\n", { flag: "wx" });
  try {
    linkSync(tmp, sidecar);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST")
      throw new UsageError(`Responses already finalized (won't overwrite): ${sidecar}`);
    throw err;
  } finally {
    unlinkSync(tmp);
  }
  return sidecar;
}

export function readResponses(sidecarPath: string): ResponsesArtifact {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(sidecarPath, "utf8")); }
  catch { throw new UsageError(`Responses sidecar is not valid JSON: ${sidecarPath}`); }
  const v = validateResponsesArtifact(parsed);
  if (!v.ok) throw new UsageError(`Responses sidecar is malformed (${sidecarPath}): ${v.errors}`);
  return parsed as ResponsesArtifact;
}
