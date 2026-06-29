import { describe, it, expect, beforeEach } from "vitest";
import { writeRoundOnce, readRound, listRounds, type RoundArtifact } from "../../src/core/persistence.js";
import { UsageError } from "../../src/core/errors.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const artifact = (round: number): RoundArtifact => ({
  schemaVersion: 1, round, lineageId: "L1", timestamp: "T", stage: "spec",
  author: { provider: "anthropic", model: "a" }, reviewer: { provider: "openai", model: "o" },
  document_sha256: "d".repeat(64), criteria_sha256: "c".repeat(64), prior_document_sha256: null,
  // honor the parent-hash invariant (round 1 ⇒ null; round > 1 ⇒ non-null) so the fixture is a valid envelope
  parent_round_sha256: round === 1 ? null : "e".repeat(64),
  parent_responses_sha256: round === 1 ? null : "f".repeat(64),
  prior_approval_sha256: null,
  criteriaMeta: { "CRIT-A": { required: true } }, requirementIds: [],
  verdict: "approved",
  result: { feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
    criteriaCoverage: [], upstreamCoverage: [], findings: [] }
});

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "rd-")); });

describe("persistence", () => {
  it("writes and reads a round artifact", () => {
    const p = writeRoundOnce(dir, "L1", 1, artifact(1));
    expect(p.endsWith(join("L1", "round-1.json"))).toBe(true);
    expect(readRound(p).round).toBe(1);
  });
  it("refuses to overwrite an existing round (data-loss guard)", () => {
    writeRoundOnce(dir, "L1", 1, artifact(1));
    expect(() => writeRoundOnce(dir, "L1", 1, artifact(1))).toThrow(UsageError);
  });
  it("lists rounds ascending and returns [] for an unknown lineage", () => {
    writeRoundOnce(dir, "L1", 2, artifact(2));
    writeRoundOnce(dir, "L1", 1, artifact(1));
    expect(listRounds(join(dir, "L1"))).toEqual([1, 2]);
    expect(listRounds(join(dir, "nope"))).toEqual([]);
  });
  it("rejects a malformed round artifact on read (corruption/stale guard)", async () => {
    const p = writeRoundOnce(dir, "L1", 1, artifact(1));
    await writeFile(p.replace(/round-1\.json$/, "round-9.json"), '{"schemaVersion":1,"round":9}');
    expect(() => readRound(p.replace(/round-1\.json$/, "round-9.json"))).toThrow(UsageError);
    await writeFile(p.replace(/round-1\.json$/, "round-8.json"), "not json");
    expect(() => readRound(p.replace(/round-1\.json$/, "round-8.json"))).toThrow(UsageError);
  });
  it("refuses to write a malformed artifact (P2 fail-closed)", () => {
    const bad = { ...artifact(1), verdict: "nope" } as any;
    expect(() => writeRoundOnce(dir, "L1", 1, bad)).toThrow(UsageError);
  });
  it("refuses to write an artifact whose round/lineageId does not match the target (P2)", () => {
    expect(() => writeRoundOnce(dir, "L1", 1, artifact(2))).toThrow(UsageError);        // round 2 artifact at round 1
    expect(() => writeRoundOnce(dir, "OTHER", 1, artifact(1))).toThrow(UsageError);     // lineageId mismatch
  });
});
