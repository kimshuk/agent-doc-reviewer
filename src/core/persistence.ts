import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Identity, CriteriaMeta, ReviewResult, Verdict, Stage } from "./types.js";
import { UsageError } from "./errors.js";
import { validateRoundArtifact } from "./schema.js";

export interface RoundArtifact {
  schemaVersion: 1; round: number; lineageId: string; timestamp: string; stage: Stage;
  author: Identity; reviewer: Identity;
  document_sha256: string; criteria_sha256: string; prior_document_sha256: string | null;
  parent_round_sha256: string | null; parent_responses_sha256: string | null; prior_approval_sha256: string | null;
  criteriaMeta: CriteriaMeta; requirementIds: string[];
  verdict: Verdict; result: ReviewResult;
}

export function writeRoundOnce(reviewDir: string, lineageId: string, round: number, artifact: RoundArtifact): string {
  // Fail closed: never persist a malformed or mislabeled write-once artifact (P2 hardening).
  const v = validateRoundArtifact(artifact);
  if (!v.ok) throw new UsageError(`Refusing to write a malformed round artifact: ${v.errors}`);
  if (artifact.round !== round || artifact.lineageId !== lineageId)
    throw new UsageError(`Round artifact identity (${artifact.lineageId}/round-${artifact.round}) does not match write target (${lineageId}/round-${round})`);
  const dir = join(reviewDir, lineageId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `round-${round}.json`);
  if (existsSync(path)) throw new UsageError(`Round artifact already exists (won't overwrite): ${path}`);
  writeFileSync(path, JSON.stringify(artifact, null, 2) + "\n", { flag: "wx" });
  return path;
}

export function readRound(path: string): RoundArtifact {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new UsageError(`Round artifact is not valid JSON: ${path}`); }
  const v = validateRoundArtifact(parsed);
  if (!v.ok) throw new UsageError(`Round artifact is malformed (${path}): ${v.errors}`);
  return parsed as RoundArtifact;
}

export function listRounds(lineageDir: string): number[] {
  if (!existsSync(lineageDir)) return [];
  return readdirSync(lineageDir)
    .map(n => /^round-(\d+)\.json$/.exec(n)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}
