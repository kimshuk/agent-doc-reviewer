import { describe, it, expect, vi, beforeEach } from "vitest";
import { reviewOnce, reviewDocument, UsageError } from "../../src/core/index.js";
import { readRound, writeRoundOnce } from "../../src/core/persistence.js";
import { sha256 } from "../../src/core/hash.js";
import type { ReviewerProvider, ReviewResult } from "../../src/core/types.js";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
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

  // spec stage forbids the prior fields (--prior/--prior-approval are only valid with --stage plan)
  it("rejects a priorPath on spec stage", async () => {
    await expect(reviewDocument({ ...baseInput(), priorPath: join(dir, "up.md") })).rejects.toThrow(UsageError);
  });
  it("rejects a priorApprovalPath on spec stage", async () => {
    await expect(reviewDocument({ ...baseInput(), priorApprovalPath: join(dir, "a.json") })).rejects.toThrow(UsageError);
  });
});

describe("reviewDocument — plan stage", () => {
  const baseInput = () => ({
    docPath: doc, stage: "spec" as const, criteriaPath: crit, newLineage: false,
    reviewer: { provider: mock(), model: "gpt" }, reviewerIdentity: { provider: "openai", model: "gpt" },
    author: { provider: "anthropic", model: "claude" }, allowSameModel: false,
    outDir: join(dir, "out"), now: () => "2026-06-22T00:00:00Z", mintLineageId: () => "L1"
  });

  async function setupApprovedPrior() {
    const priorPath = join(dir, "up.md");
    await writeFile(priorPath, "# Upstream\n- [REQ-X] do x\n- [REQ-Y] do y\n");
    const approvedResult: ReviewResult = {
      feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
      criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
      upstreamCoverage: [], findings: []
    };
    writeRoundOnce(`${priorPath}.review`, "S1", 1, {
      schemaVersion: 1, round: 1, lineageId: "S1", timestamp: "T", stage: "spec",
      author: { provider: "anthropic", model: "claude" }, reviewer: { provider: "openai", model: "gpt" },
      document_sha256: sha256(await readFile(priorPath, "utf8")),
      criteria_sha256: "c".repeat(64), prior_document_sha256: null,
      parent_round_sha256: null, parent_responses_sha256: null, prior_approval_sha256: null,
      criteriaMeta: { "CRIT-A": { required: true } }, requirementIds: [],
      verdict: "approved", result: approvedResult
    } as any);
    return priorPath;
  }

  it("reviews a plan against an approved prior and records prior hashes + requirementIds", async () => {
    const priorPath = await setupApprovedPrior();
    const planGood: ReviewResult = {
      feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
      criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
      upstreamCoverage: [
        { id: "REQ-X", assessment: "met", note: "", findingIds: [] },
        { id: "REQ-Y", assessment: "met", note: "", findingIds: [] }
      ],
      findings: []
    };
    const provider: ReviewerProvider = { name: "openai", review: vi.fn().mockResolvedValue(planGood) };
    const out = await reviewDocument({ ...baseInput(), stage: "plan", priorPath, reviewer: { provider, model: "gpt" } });
    expect(out.verdict).toBe("approved");
    const round = readRound(out.roundPath);
    expect(round.stage).toBe("plan");
    expect(round.prior_document_sha256).toBe(sha256(await readFile(priorPath, "utf8")));
    expect(round.prior_approval_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(round.requirementIds).toEqual(["REQ-X", "REQ-Y"]);
    expect(round.result.upstreamCoverage.map(c => c.id)).toEqual(["REQ-X", "REQ-Y"]);
  });

  it("blocks approval when an upstream [REQ-*] is not_met (plan-stage gating)", async () => {
    const priorPath = await setupApprovedPrior();
    const planNotMet: ReviewResult = {
      feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
      criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
      upstreamCoverage: [
        { id: "REQ-X", assessment: "met", note: "", findingIds: [] },
        { id: "REQ-Y", assessment: "not_met", note: "", findingIds: ["F1"] }
      ],
      findings: [{ id: "F1", status: "new", severity: "HIGH", disposition: "required", category: "x",
        claim: "c", where: { path: doc, startLine: 1, endLine: 1 }, fix: "f",
        completionCondition: "d", supersededByFindingIds: [] }]
    };
    const provider: ReviewerProvider = { name: "openai", review: vi.fn().mockResolvedValue(planNotMet) };
    const out = await reviewDocument({ ...baseInput(), stage: "plan", priorPath, reviewer: { provider, model: "gpt" } });
    expect(out.verdict).not.toBe("approved");
  });

  it("rejects --stage plan without --prior", async () => {
    await expect(reviewDocument({ ...baseInput(), stage: "plan" })).rejects.toThrow(UsageError);
  });
});
