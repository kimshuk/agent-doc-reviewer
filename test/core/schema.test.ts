import { describe, it, expect } from "vitest";
import { validateStructural, validateRoundArtifact, validateResponsesArtifact } from "../../src/core/schema.js";

const good = {
  feasibility: "feasible", feasibilityRationale: "ok", feasibilityFindingIds: [],
  criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
  upstreamCoverage: [],
  findings: [{
    id: "F1", status: "new", severity: "LOW", disposition: "optional", category: "wording",
    claim: "c", where: { path: "doc.md", startLine: 1, endLine: 1 }, fix: "f",
    completionCondition: "done", supersededByFindingIds: []
  }]
};

describe("validateStructural", () => {
  it("accepts a well-formed ReviewResult", () => {
    expect(validateStructural(good).ok).toBe(true);
  });
  it("rejects a missing required field", () => {
    const bad = structuredClone(good) as any; delete bad.findings[0].supersededByFindingIds;
    const r = validateStructural(bad); expect(r.ok).toBe(false);
  });
  it("rejects an unknown enum value", () => {
    const bad = structuredClone(good) as any; bad.findings[0].severity = "BLOCKER";
    expect(validateStructural(bad).ok).toBe(false);
  });
  it("rejects an extra property", () => {
    const bad = structuredClone(good) as any; bad.extra = 1;
    expect(validateStructural(bad).ok).toBe(false);
  });
  it("rejects startLine < 1", () => {
    const bad = structuredClone(good) as any; bad.findings[0].where.startLine = 0;
    expect(validateStructural(bad).ok).toBe(false);
  });
});

const goodRound = {
  schemaVersion: 1, round: 1, lineageId: "L1", timestamp: "T", stage: "spec",
  author: { provider: "anthropic", model: "a" }, reviewer: { provider: "openai", model: "o" },
  document_sha256: "d".repeat(64), criteria_sha256: "c".repeat(64), prior_document_sha256: null,
  parent_round_sha256: null, parent_responses_sha256: null, prior_approval_sha256: null,
  criteriaMeta: { "CRIT-A": { required: true } }, requirementIds: [],
  verdict: "approved", result: good
};

describe("validateRoundArtifact", () => {
  it("accepts a well-formed round envelope", () => {
    expect(validateRoundArtifact(goodRound).ok).toBe(true);
  });
  it("rejects a missing envelope field (document_sha256)", () => {
    const bad = structuredClone(goodRound) as any; delete bad.document_sha256;
    expect(validateRoundArtifact(bad).ok).toBe(false);
  });
  it("rejects a bad verdict enum", () => {
    const bad = structuredClone(goodRound) as any; bad.verdict = "ok";
    expect(validateRoundArtifact(bad).ok).toBe(false);
  });
  it("rejects a malformed nested result", () => {
    const bad = structuredClone(goodRound) as any; bad.result.feasibility = "maybe";
    expect(validateRoundArtifact(bad).ok).toBe(false);
  });
  it("rejects round > 1 with null parent hashes (continuity cannot be skipped)", () => {
    const bad = structuredClone(goodRound) as any;
    bad.round = 2; bad.parent_round_sha256 = null; bad.parent_responses_sha256 = null;
    expect(validateRoundArtifact(bad).ok).toBe(false);
  });
  it("rejects round 1 carrying non-null parent hashes", () => {
    const bad = structuredClone(goodRound) as any;
    bad.round = 1; bad.parent_round_sha256 = "b".repeat(64); bad.parent_responses_sha256 = "c".repeat(64);
    expect(validateRoundArtifact(bad).ok).toBe(false);
  });
  it("rejects round 2 with only one parent hash set (must be together)", () => {
    const bad = structuredClone(goodRound) as any;
    bad.round = 2; bad.parent_round_sha256 = "b".repeat(64); bad.parent_responses_sha256 = null;
    expect(validateRoundArtifact(bad).ok).toBe(false);
  });
  it("rejects an empty author identity", () => {
    const bad = structuredClone(goodRound) as any; bad.author = { provider: "", model: "" };
    expect(validateRoundArtifact(bad).ok).toBe(false);
  });
});

describe("validateResponsesArtifact", () => {
  const goodSidecar = {
    round: 1, lineageId: "L1", round_sha256: "a".repeat(64), finalized: true,
    responses: [{ findingId: "F1", response: "accepted_and_revised" }]
  };
  it("accepts a well-formed sidecar", () => {
    expect(validateResponsesArtifact(goodSidecar).ok).toBe(true);
  });
  it("rejects finalized:false", () => {
    const bad = structuredClone(goodSidecar) as any; bad.finalized = false;
    expect(validateResponsesArtifact(bad).ok).toBe(false);
  });
  it("rejects an unknown response enum", () => {
    const bad = structuredClone(goodSidecar) as any; bad.responses[0].response = "ignored";
    expect(validateResponsesArtifact(bad).ok).toBe(false);
  });
});
