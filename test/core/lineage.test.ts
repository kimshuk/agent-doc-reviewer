import { describe, it, expect, beforeEach } from "vitest";
import { selectLineage } from "../../src/core/lineage.js";
import { writeRoundOnce, type RoundArtifact } from "../../src/core/persistence.js";
import { finalizeResponses } from "../../src/core/responses.js";
import { sha256OfFile } from "../../src/core/hash.js";
import { UsageError } from "../../src/core/errors.js";
import type { Finding, ReviewResult } from "../../src/core/types.js";
import { mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const f = (id: string): Finding => ({
  id, status: "new", severity: "HIGH", disposition: "required", category: "x",
  claim: "c", where: { path: "d.md", startLine: 1, endLine: 1 }, fix: "f",
  completionCondition: "done", supersededByFindingIds: []
});
const res = (findings: Finding[]): ReviewResult => ({
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [], upstreamCoverage: [], findings
});
const art = (over: Partial<RoundArtifact>): RoundArtifact => ({
  schemaVersion: 1, round: 1, lineageId: "L1", timestamp: "T", stage: "spec",
  author: { provider: "anthropic", model: "a" }, reviewer: { provider: "openai", model: "o" },
  document_sha256: "d".repeat(64), criteria_sha256: "c".repeat(64), prior_document_sha256: null,
  parent_round_sha256: null, parent_responses_sha256: null, prior_approval_sha256: null,
  criteriaMeta: {}, requirementIds: [], verdict: "changes_requested", result: res([f("F1")]), ...over
});

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "rd-")); });
const common = () => ({ reviewDir: dir, stage: "spec" as const, criteriaSha256: "c".repeat(64), priorDocumentSha256: null, mintLineageId: () => "LX" });

describe("selectLineage", () => {
  it("bootstraps round 1 in a fresh lineage when no rounds exist", async () => {
    const sel = await selectLineage({ ...common(), newLineage: false });
    expect(sel).toMatchObject({ lineageId: "LX", round: 1, parentRoundSha256: null, parentResponsesSha256: null });
  });
  it("errors if both --prior-log and --new-lineage are given", async () => {
    await expect(selectLineage({ ...common(), newLineage: true, priorLogPath: "x" }))
      .rejects.toThrow(UsageError);
  });
  it("mints a fresh lineage with --new-lineage", async () => {
    const sel = await selectLineage({ ...common(), newLineage: true });
    expect(sel.round).toBe(1);
    expect(sel.lineageId).toBe("LX");
  });
  it("extends the lineage of --prior-log and records both parent hashes", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, art({}));
    await finalizeResponses(roundPath, [{ findingId: "F1", response: "accepted_and_revised" }]);
    const sel = await selectLineage({ ...common(), newLineage: false, priorLogPath: roundPath });
    expect(sel).toMatchObject({ lineageId: "L1", round: 2 });
    expect(sel.parentRoundSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sel.parentResponsesSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sel.priorFindings.map(x => x.id)).toEqual(["F1"]);
    expect(sel.priorResponses.map(x => x.findingId)).toEqual(["F1"]);
  });
  it("rejects a stale --prior-log that is not the latest round", async () => {
    const r1 = writeRoundOnce(dir, "L1", 1, art({ round: 1 }));
    await finalizeResponses(r1, [{ findingId: "F1", response: "accepted_and_revised" }]);
    // round 2 must carry both parent hashes (envelope invariant) to be a valid round to write
    const r2 = writeRoundOnce(dir, "L1", 2, art({ round: 2, parent_round_sha256: "e".repeat(64), parent_responses_sha256: "f".repeat(64) }));
    await finalizeResponses(r2, [{ findingId: "F1", response: "accepted_and_revised" }]);
    await expect(selectLineage({ ...common(), newLineage: false, priorLogPath: r1 }))
      .rejects.toThrow(UsageError);
  });
  it("rejects a --prior-log whose criteria hash differs", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, art({ criteria_sha256: "e".repeat(64) }));
    await finalizeResponses(roundPath, [{ findingId: "F1", response: "accepted_and_revised" }]);
    await expect(selectLineage({ ...common(), newLineage: false, priorLogPath: roundPath }))
      .rejects.toThrow(UsageError);
  });
  it("rejects a --prior-log whose sidecar is not finalized", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, art({}));
    // no finalizeResponses call -> no sidecar
    expect(existsSync(roundPath.replace(/\.json$/, ".responses.json"))).toBe(false);
    await expect(selectLineage({ ...common(), newLineage: false, priorLogPath: roundPath }))
      .rejects.toThrow(UsageError);
  });
  it("rejects a --prior-log whose finalized sidecar was mutated after the fact (stale/swap guard)", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, art({}));
    const sidecar = await finalizeResponses(roundPath, [{ findingId: "F1", response: "accepted_and_revised" }]);
    const bad = JSON.parse(await readFile(sidecar, "utf8"));
    bad.round_sha256 = "0".repeat(64);   // no longer matches the round it answers
    await writeFile(sidecar, JSON.stringify(bad));
    await expect(selectLineage({ ...common(), newLineage: false, priorLogPath: roundPath }))
      .rejects.toThrow(UsageError);
  });
  it("re-verifies the selected round's parent pair against round-(N-1) on disk", async () => {
    const r1 = writeRoundOnce(dir, "L1", 1, art({ round: 1 }));
    const s1 = await finalizeResponses(r1, [{ findingId: "F1", response: "accepted_and_revised" }]);
    const r2 = writeRoundOnce(dir, "L1", 2, art({
      round: 2, parent_round_sha256: await sha256OfFile(r1), parent_responses_sha256: await sha256OfFile(s1)
    }));
    await finalizeResponses(r2, [{ findingId: "F1", response: "accepted_and_revised" }]);
    // intact lineage -> selecting round 2 succeeds (next round is 3)
    await expect(selectLineage({ ...common(), newLineage: false, priorLogPath: r2 }))
      .resolves.toMatchObject({ round: 3 });
    // corrupt round 1 so its hash no longer matches round 2's recorded parent_round_sha256
    const mutated = { ...JSON.parse(await readFile(r1, "utf8")), timestamp: "MUTATED" };
    await writeFile(r1, JSON.stringify(mutated));
    await expect(selectLineage({ ...common(), newLineage: false, priorLogPath: r2 }))
      .rejects.toThrow(UsageError);
  });
  it("errors when rounds exist but neither flag is given", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, art({}));
    await finalizeResponses(roundPath, [{ findingId: "F1", response: "accepted_and_revised" }]);
    await expect(selectLineage({ ...common(), newLineage: false }))
      .rejects.toThrow(UsageError);
  });
  it("rejects a --prior-log whose filename is not round-<n>.json with a clear error (not NaN)", async () => {
    const r1 = writeRoundOnce(dir, "L1", 1, art({}));
    const s1 = await finalizeResponses(r1, [{ findingId: "F1", response: "accepted_and_revised" }]);
    // a byte-identical copy under a non-standard name: every hash/identity check would pass,
    // but the round number must come from the validated prior.round, not the filename.
    const renamed = join(dir, "L1", "r1.json");
    await copyFile(r1, renamed);
    await copyFile(s1, join(dir, "L1", "r1.responses.json"));
    await expect(selectLineage({ ...common(), newLineage: false, priorLogPath: renamed }))
      .rejects.toThrow(/round-1\.json/);
  });
});
