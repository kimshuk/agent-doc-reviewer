import { describe, it, expect, vi, beforeEach } from "vitest";
import { reviewOnce, reviewDocument, UsageError } from "../../src/core/index.js";
import { readRound } from "../../src/core/persistence.js";
import type { ReviewerProvider, ReviewResult } from "../../src/core/types.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const good: ReviewResult = {
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
  upstreamCoverage: [], findings: []
};
const mock = (): ReviewerProvider => ({ name: "openai", review: vi.fn().mockResolvedValue(good) });

let dir = "", doc = "", crit = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rd-"));
  doc = join(dir, "spec.md"); await writeFile(doc, "# Title\nbody\n");
  crit = join(dir, "criteria.md"); await writeFile(crit, "- [CRIT-A] keep small\n");
});

describe("reviewOnce", () => {
  it("runs a stateless spec review and returns verdict + result (no disk writes)", async () => {
    const out = await reviewOnce({
      docPath: doc, stage: "spec", criteriaPath: crit,
      reviewer: { provider: mock(), model: "gpt" }, reviewerIdentity: { provider: "openai", model: "gpt" },
      author: { provider: "anthropic", model: "claude" }, allowSameModel: false,
      priorFindings: [], priorResponses: []
    });
    expect(out.verdict).toBe("approved");
    expect(out.result.findings).toEqual([]);
  });

  it("throws when reviewer identity equals author and same-model is not allowed", async () => {
    await expect(reviewOnce({
      docPath: doc, stage: "spec", criteriaPath: crit,
      reviewer: { provider: mock(), model: "x" }, reviewerIdentity: { provider: "openai", model: "x" },
      author: { provider: "openai", model: "x" }, allowSameModel: false,
      priorFindings: [], priorResponses: []
    })).rejects.toThrow();
  });

  it("wires the document line count into location validation (out-of-bounds finding is rejected)", async () => {
    // doc is 2 visible lines; a finding citing endLine 999 must fail location bounds -> repair ->
    // (same bad output) -> ValidationError. Proves inputLineCounts[docPath] reaches the validator.
    const oob: ReviewResult = {
      ...good,
      criteriaCoverage: [{ id: "CRIT-A", assessment: "not_met", note: "", findingIds: ["F1"] }],
      findings: [{
        id: "F1", status: "new", severity: "HIGH", disposition: "required", category: "x",
        claim: "c", where: { path: doc, startLine: 1, endLine: 999 }, fix: "f",
        completionCondition: "d", supersededByFindingIds: []
      }]
    };
    const provider: ReviewerProvider = { name: "openai", review: vi.fn().mockResolvedValue(oob) };
    await expect(reviewOnce({
      docPath: doc, stage: "spec", criteriaPath: crit,
      reviewer: { provider, model: "gpt" }, reviewerIdentity: { provider: "openai", model: "gpt" },
      author: { provider: "anthropic", model: "claude" }, allowSameModel: false,
      priorFindings: [], priorResponses: []
    })).rejects.toThrow();
  });
});

describe("reviewDocument", () => {
  const baseInput = () => ({
    docPath: doc, stage: "spec" as const, criteriaPath: crit, newLineage: false,
    reviewer: { provider: mock(), model: "gpt" }, reviewerIdentity: { provider: "openai", model: "gpt" },
    author: { provider: "anthropic", model: "claude" }, allowSameModel: false,
    outDir: join(dir, "out"), now: () => "2026-06-22T00:00:00Z", mintLineageId: () => "L1"
  });

  it("runs a spec review and writes an immutable round-1 artifact", async () => {
    const out = await reviewDocument(baseInput());
    expect(out.verdict).toBe("approved");
    expect(out.roundPath.endsWith(join("L1", "round-1.json"))).toBe(true);
    const round = readRound(out.roundPath);
    expect(round.criteria_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(round.document_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(round.author).toEqual({ provider: "anthropic", model: "claude" });
    expect(round.reviewer).toEqual({ provider: "openai", model: "gpt" });
    expect(round.parent_round_sha256).toBeNull();
    expect(round.result.findings).toEqual([]);
  });

  it("throws when reviewer identity equals author and same-model is not allowed", async () => {
    await expect(reviewDocument({
      ...baseInput(),
      reviewer: { provider: mock(), model: "x" }, reviewerIdentity: { provider: "openai", model: "x" },
      author: { provider: "openai", model: "x" }
    })).rejects.toThrow();
  });

  // Phase-2 reserves the plan-stage fields but does NOT support them: they must be rejected
  // (UsageError), never silently ignored. Phase 3 activates them.
  it("rejects stage:plan as unsupported until Phase 3", async () => {
    await expect(reviewDocument({ ...baseInput(), stage: "plan" })).rejects.toThrow(UsageError);
  });
  it("rejects a reserved priorPath as unsupported until Phase 3", async () => {
    await expect(reviewDocument({ ...baseInput(), priorPath: join(dir, "up.md") })).rejects.toThrow(UsageError);
  });
  it("rejects a reserved priorApprovalPath as unsupported until Phase 3", async () => {
    await expect(reviewDocument({ ...baseInput(), priorApprovalPath: join(dir, "a.json") })).rejects.toThrow(UsageError);
  });
});
