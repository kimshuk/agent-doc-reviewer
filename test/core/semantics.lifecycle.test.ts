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
  criteriaMeta: { "CRIT-A": { required: true } },
  requirementIds: [], priorFindings: [], inputLineCounts: { "d.md": 10 }, ...over
});
const result = (findings: Finding[], over: Partial<ReviewResult> = {}): ReviewResult => ({
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
  upstreamCoverage: [], findings, ...over
});
// criteriaCoverage that links F1 as a not_met required finding (so an active F1 is consistent with coverage)
const linkF1 = { criteriaCoverage: [{ id: "CRIT-A", assessment: "not_met" as const, note: "", findingIds: ["F1"] }] };

describe("semantic lifecycle/feasibility/location validation (Phase 1)", () => {
  // #2 finding-id uniqueness
  it("fails on duplicate finding ids", () => {
    expect(validateSemantic(result([f({ id: "F1" }), f({ id: "F1" })]), ctx()).ok).toBe(false);
  });

  // #3 feasibilityFindingIds 3-way
  it("fails feasible with a non-empty feasibilityFindingIds", () => {
    expect(validateSemantic(result([], { feasibility: "feasible", feasibilityFindingIds: ["F1"] }), ctx()).ok).toBe(false);
  });
  it("fails not_feasible with an empty feasibilityFindingIds", () => {
    expect(validateSemantic(result([], { feasibility: "not_feasible", feasibilityFindingIds: [] }), ctx()).ok).toBe(false);
  });
  it("fails feasible_with_conditions with an empty feasibilityFindingIds", () => {
    expect(validateSemantic(result([], { feasibility: "feasible_with_conditions", feasibilityFindingIds: [] }), ctx()).ok).toBe(false);
  });
  it("fails feasibilityFindingIds referencing an unknown finding", () => {
    expect(validateSemantic(result([], { feasibility: "feasible_with_conditions", feasibilityFindingIds: ["NOPE"] }), ctx()).ok).toBe(false);
  });
  it("passes a valid not_feasible with an active required feasibility finding", () => {
    const ok = result([f({ id: "F1", disposition: "required", status: "new" })],
      { feasibility: "not_feasible", feasibilityFindingIds: ["F1"], ...linkF1 });
    expect(validateSemantic(ok, ctx()).ok).toBe(true);
  });

  // #4 location bounds (full mode)
  it("fails a where citation past the file's line count", () => {
    expect(validateSemantic(result([f({ where: { path: "d.md", startLine: 5, endLine: 99 } })], linkF1), ctx()).ok).toBe(false);
  });
  it("fails a where citation with an unknown path", () => {
    expect(validateSemantic(result([f({ where: { path: "other.md", startLine: 1, endLine: 1 } })], linkF1), ctx()).ok).toBe(false);
  });
  it("fails when startLine > endLine", () => {
    expect(validateSemantic(result([f({ where: { path: "d.md", startLine: 5, endLine: 2 } })], linkF1), ctx()).ok).toBe(false);
  });

  // Phase-1 stateless invariant (approval-leak guard)
  it("fails a non-new finding (resolved) in full mode with empty priors", () => {
    expect(validateSemantic(result([f({ id: "F1", status: "resolved" })]), ctx()).ok).toBe(false);
  });
  it("fails a finding carrying supersededByFindingIds in full mode with empty priors", () => {
    expect(validateSemantic(result([f({ id: "F1", status: "new", supersededByFindingIds: ["F2"] })]), ctx()).ok).toBe(false);
  });
  it("passes an all-new, no-supersede result in full mode with empty priors", () => {
    expect(validateSemantic(result([f({ id: "F1", status: "new" })], linkF1), ctx()).ok).toBe(true);
  });

  // mode gate: within_result must NOT fire the invariant or location (approval re-verification path)
  it("allows a resolved finding (and out-of-bounds where) in within_result mode", () => {
    const r = result([f({ id: "F1", status: "resolved", where: { path: "d.md", startLine: 999, endLine: 999 } })]);
    expect(validateSemantic(r, ctx({ mode: "within_result" })).ok).toBe(true);
  });

  // mode gate: full mode with NON-empty priors must NOT fire the stateless invariant
  it("does not fire the stateless invariant when priorFindings is non-empty", () => {
    const prior = [f({ id: "F1", status: "new" })];
    const r = result([f({ id: "F1", status: "still_present" })], linkF1);
    expect(validateSemantic(r, ctx({ priorFindings: prior })).ok).toBe(true);
  });
});

describe("semantic Phase-2 lifecycle: provenance, carry-forward, supersede linkage", () => {
  // provenance: a new id may not collide with a prior id
  it("fails when a new id collides with a prior id", () => {
    const prior = [f({ id: "F1" })];
    expect(validateSemantic(result([f({ id: "F1", status: "new" })], linkF1), ctx({ priorFindings: prior })).ok).toBe(false);
  });

  // provenance: a carried status must have prior provenance
  it("fails when a carried status has no prior provenance", () => {
    expect(validateSemantic(result([f({ id: "F9", status: "still_present" })], { criteriaCoverage: [{ id: "CRIT-A", assessment: "not_met", note: "", findingIds: ["F9"] }] }), ctx()).ok).toBe(false);
  });

  // carry-forward completeness: a prior active finding may not be dropped
  it("fails when a prior active finding is dropped", () => {
    const prior = [f({ id: "F1", status: "new" })];
    expect(validateSemantic(result([]), ctx({ priorFindings: prior })).ok).toBe(false);
  });

  // carry-forward completeness: a prior terminal finding may be omitted
  it("allows omitting a prior terminal finding", () => {
    const prior = [f({ id: "F1", status: "resolved" })];
    expect(validateSemantic(result([]), ctx({ priorFindings: prior })).ok).toBe(true);
  });

  // carry-forward completeness: a prior active finding must reappear with a terminal/still_present status
  it("allows a prior active finding carried as resolved", () => {
    const prior = [f({ id: "F1", status: "new" })];
    expect(validateSemantic(result([f({ id: "F1", status: "resolved" })]), ctx({ priorFindings: prior })).ok).toBe(true);
  });

  // supersede linkage: a superseded finding requires an active replacement
  it("fails a superseded finding with no active replacement", () => {
    const prior = [f({ id: "F1", status: "new", disposition: "required" })];
    const noRepl = result([f({ id: "F1", status: "superseded", disposition: "required", supersededByFindingIds: [] })]);
    expect(validateSemantic(noRepl, ctx({ priorFindings: prior })).ok).toBe(false);
  });

  // supersede linkage: a required superseded finding requires an active required replacement
  it("passes a superseded finding replaced by an active required finding", () => {
    const prior = [f({ id: "F1", status: "new", disposition: "required" })];
    const withRepl = result(
      [
        f({ id: "F1", status: "superseded", disposition: "required", supersededByFindingIds: ["F2"] }),
        f({ id: "F2", status: "new", disposition: "required" }),
      ],
      { criteriaCoverage: [{ id: "CRIT-A", assessment: "not_met", note: "", findingIds: ["F2"] }] }
    );
    expect(validateSemantic(withRepl, ctx({ priorFindings: prior })).ok).toBe(true);
  });
});
