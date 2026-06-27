import { describe, it, expect } from "vitest";
import { validateStructural } from "../../src/core/schema.js";

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
