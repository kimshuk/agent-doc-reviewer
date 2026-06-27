import { describe, it, expect } from "vitest";
import { computeVerdict } from "../../src/core/verdict.js";
import type { ReviewResult, Finding, CriteriaMeta } from "../../src/core/types.js";

const f = (over: Partial<Finding>): Finding => ({
  id: "F", status: "new", severity: "LOW", disposition: "optional", category: "x",
  claim: "c", where: { path: "d.md", startLine: 1, endLine: 1 }, fix: "f",
  completionCondition: "done", supersededByFindingIds: [], ...over
});
const base = (over: Partial<ReviewResult>): ReviewResult => ({
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [], upstreamCoverage: [], findings: [], ...over
});
const meta: CriteriaMeta = { "CRIT-A": { required: true }, "CRIT-B": { required: false } };

describe("computeVerdict", () => {
  it("approves a clean feasible result", () => {
    expect(computeVerdict(base({}), meta)).toBe("approved");
  });
  it("blocks on an active required finding", () => {
    expect(computeVerdict(base({ findings: [f({ disposition: "required", status: "still_present" })] }), meta))
      .toBe("changes_requested");
  });
  it("does NOT block on a resolved required finding", () => {
    expect(computeVerdict(base({ findings: [f({ disposition: "required", status: "resolved" })] }), meta))
      .toBe("approved");
  });
  it("blocks when a MEDIUM-severity finding is required", () => {
    expect(computeVerdict(base({ findings: [f({ severity: "MEDIUM", disposition: "required" })] }), meta))
      .toBe("changes_requested");
  });
  it("blocks on not_met of a required criterion but not an optional one", () => {
    expect(computeVerdict(base({ criteriaCoverage: [{ id: "CRIT-A", assessment: "not_met", note: "", findingIds: ["F"] }] }), meta))
      .toBe("changes_requested");
    expect(computeVerdict(base({ criteriaCoverage: [{ id: "CRIT-B", assessment: "not_met", note: "", findingIds: ["F"] }] }), meta))
      .toBe("approved");
  });
  it("blocks on not_met of any upstream requirement and on not_feasible", () => {
    expect(computeVerdict(base({ upstreamCoverage: [{ id: "REQ-X", assessment: "not_met", note: "", findingIds: ["F"] }] }), meta))
      .toBe("changes_requested");
    expect(computeVerdict(base({ feasibility: "not_feasible", feasibilityFindingIds: ["F"] }), meta))
      .toBe("changes_requested");
  });
});
