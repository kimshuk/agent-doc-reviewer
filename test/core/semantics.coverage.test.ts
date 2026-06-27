import { describe, it, expect } from "vitest";
import { validateSemantic, type SemanticContext } from "../../src/core/semantics.js";
import type { ReviewResult, Finding } from "../../src/core/types.js";

const f = (over: Partial<Finding>): Finding => ({
  id: "F1", status: "new", severity: "HIGH", disposition: "required", category: "x",
  claim: "c", where: { path: "d.md", startLine: 1, endLine: 1 }, fix: "f",
  completionCondition: "done", supersededByFindingIds: [], ...over
});
const ctx = (over: Partial<SemanticContext> = {}): SemanticContext => ({
  stage: "spec", mode: "full",
  criteriaMeta: { "CRIT-A": { required: true }, "CRIT-B": { required: false } },
  requirementIds: [], priorFindings: [], inputLineCounts: { "d.md": 10 }, ...over
});
const result = (over: Partial<ReviewResult>): ReviewResult => ({
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [
    { id: "CRIT-A", assessment: "met", note: "", findingIds: [] },
    { id: "CRIT-B", assessment: "met", note: "", findingIds: [] }
  ],
  upstreamCoverage: [], findings: [], ...over
});

describe("semantic coverage validation", () => {
  it("passes when coverage exactly matches the criteria set", () => {
    expect(validateSemantic(result({}), ctx()).ok).toBe(true);
  });
  it("fails on a missing criterion", () => {
    const r = result({ criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }] });
    expect(validateSemantic(r, ctx()).ok).toBe(false);
  });
  it("fails on an unknown criterion id", () => {
    const r = result({ criteriaCoverage: [
      { id: "CRIT-A", assessment: "met", note: "", findingIds: [] },
      { id: "CRIT-B", assessment: "met", note: "", findingIds: [] },
      { id: "CRIT-Z", assessment: "met", note: "", findingIds: [] }
    ] });
    expect(validateSemantic(r, ctx()).ok).toBe(false);
  });
  it("requires empty findingIds for met / not_applicable", () => {
    const r = result({ criteriaCoverage: [
      { id: "CRIT-A", assessment: "met", note: "", findingIds: ["F1"] },
      { id: "CRIT-B", assessment: "met", note: "", findingIds: [] }
    ], findings: [f({})] });
    expect(validateSemantic(r, ctx()).ok).toBe(false);
  });
  it("requires an active required finding for not_met of a required criterion", () => {
    const noLink = result({ criteriaCoverage: [
      { id: "CRIT-A", assessment: "not_met", note: "", findingIds: [] },
      { id: "CRIT-B", assessment: "met", note: "", findingIds: [] }
    ] });
    expect(validateSemantic(noLink, ctx()).ok).toBe(false);
    const linked = result({ criteriaCoverage: [
      { id: "CRIT-A", assessment: "not_met", note: "", findingIds: ["F1"] },
      { id: "CRIT-B", assessment: "met", note: "", findingIds: [] }
    ], findings: [f({ id: "F1", disposition: "required", status: "new" })] });
    expect(validateSemantic(linked, ctx()).ok).toBe(true);
  });
  it("fails not_applicable on a required criterion, allows it on an optional one", () => {
    const reqNA = result({ criteriaCoverage: [
      { id: "CRIT-A", assessment: "not_applicable", note: "", findingIds: [] },
      { id: "CRIT-B", assessment: "met", note: "", findingIds: [] }
    ] });
    expect(validateSemantic(reqNA, ctx()).ok).toBe(false);
    const optNA = result({ criteriaCoverage: [
      { id: "CRIT-A", assessment: "met", note: "", findingIds: [] },
      { id: "CRIT-B", assessment: "not_applicable", note: "", findingIds: [] }
    ] });
    expect(validateSemantic(optNA, ctx()).ok).toBe(true);
  });
  it("requires upstreamCoverage to be empty in stage:spec", () => {
    const r = result({ upstreamCoverage: [{ id: "REQ-X", assessment: "met", note: "", findingIds: [] }] });
    expect(validateSemantic(r, ctx()).ok).toBe(false);
  });
});
