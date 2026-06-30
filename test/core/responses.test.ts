import { describe, it, expect, beforeEach } from "vitest";
import { validateResponses, finalizeResponses, readResponses, sidecarPathFor } from "../../src/core/responses.js";
import { writeRoundOnce, type RoundArtifact } from "../../src/core/persistence.js";
import { UsageError } from "../../src/core/errors.js";
import type { Finding, ReviewResult } from "../../src/core/types.js";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const f = (over: Partial<Finding>): Finding => ({
  id: "F1", status: "new", severity: "HIGH", disposition: "required", category: "x",
  claim: "c", where: { path: "d.md", startLine: 1, endLine: 1 }, fix: "f",
  completionCondition: "done", supersededByFindingIds: [], ...over
});
const result = (findings: Finding[]): ReviewResult => ({
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [], upstreamCoverage: [], findings
});
const artifact = (res: ReviewResult): RoundArtifact => ({
  schemaVersion: 1, round: 1, lineageId: "L1", timestamp: "T", stage: "spec",
  author: { provider: "anthropic", model: "a" }, reviewer: { provider: "openai", model: "o" },
  document_sha256: "d".repeat(64), criteria_sha256: "c".repeat(64), prior_document_sha256: null,
  parent_round_sha256: null, parent_responses_sha256: null, prior_approval_sha256: null,
  criteriaMeta: {}, requirementIds: [], verdict: "changes_requested", result: res
});

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "rd-")); });

describe("validateResponses", () => {
  const res = result([f({ id: "F1" }), f({ id: "F2", status: "resolved" })]);
  it("requires exactly one response per active finding and none for terminal", () => {
    expect(validateResponses([{ findingId: "F1", response: "accepted_and_revised" }], res).ok).toBe(true);
    expect(validateResponses([], res).ok).toBe(false); // F1 missing
    expect(validateResponses([
      { findingId: "F1", response: "accepted_and_revised" },
      { findingId: "F2", response: "accepted_and_revised" }
    ], res).ok).toBe(false); // F2 is terminal
  });
  it("rejects duplicate and unknown finding ids", () => {
    expect(validateResponses([
      { findingId: "F1", response: "accepted_and_revised" },
      { findingId: "F1", response: "accepted_and_revised" }
    ], res).ok).toBe(false);
    expect(validateResponses([{ findingId: "ZZ", response: "accepted_and_revised" }], res).ok).toBe(false);
  });
  it("requires evidence for rejected_with_evidence / already_addressed", () => {
    expect(validateResponses([{ findingId: "F1", response: "rejected_with_evidence" }], res).ok).toBe(false);
    expect(validateResponses([{ findingId: "F1", response: "rejected_with_evidence", evidence: "see L1" }], res).ok).toBe(true);
  });
});

describe("finalizeResponses", () => {
  it("writes a finalized write-once sidecar pinned to the round hash", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, artifact(result([f({ id: "F1" })])));
    const sidecar = await finalizeResponses(roundPath, [{ findingId: "F1", response: "accepted_and_revised" }]);
    expect(sidecar).toBe(sidecarPathFor(roundPath));
    const read = readResponses(sidecar);
    expect(read.finalized).toBe(true);
    expect(read.responses).toHaveLength(1);
    expect(read.round_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses to re-finalize and does NOT clobber an existing sidecar (no-clobber)", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, artifact(result([f({ id: "F1" })])));
    const sidecar = sidecarPathFor(roundPath);
    // Pre-create the sidecar with sentinel content so a plain rename WOULD overwrite it.
    await writeFile(sidecar, "SENTINEL");
    await expect(finalizeResponses(roundPath, [{ findingId: "F1", response: "accepted_and_revised" }]))
      .rejects.toThrow(UsageError);
    // The original file must be untouched (create-if-absent semantics, not overwrite).
    expect(await readFile(sidecar, "utf8")).toBe("SENTINEL");
  });
  it("rejects invalid responses before writing", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, artifact(result([f({ id: "F1" })])));
    await expect(finalizeResponses(roundPath, [])).rejects.toThrow(UsageError);
  });
  it("refuses to finalize a response with an invalid kind (schema fail-closed, no sidecar written)", async () => {
    const roundPath = writeRoundOnce(dir, "L1", 1, artifact(result([f({ id: "F1" })])));
    // "accepted" is not a valid AuthorResponseKind; validateResponses alone would let it through
    // (it's just absent from the evidence-required set), so the envelope schema must catch it.
    await expect(finalizeResponses(roundPath, [{ findingId: "F1", response: "accepted" as any }]))
      .rejects.toThrow(UsageError);
    expect(existsSync(sidecarPathFor(roundPath))).toBe(false);
  });
});
