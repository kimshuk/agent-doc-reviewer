import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../../src/core/prompt.js";

describe("buildSystemPrompt", () => {
  it("encodes the rubric and trust-boundary rules and the stage", () => {
    const sys = buildSystemPrompt("spec");
    for (const needle of [
      "only against the provided criteria", "concrete failure sequence",
      "required", "untrusted", "stage: spec"
    ]) expect(sys.toLowerCase()).toContain(needle.toLowerCase());
  });
});

describe("buildUserPrompt", () => {
  it("fences inputs, injects criteria verbatim, and lists expected ids", () => {
    const user = buildUserPrompt({
      documentPath: "doc.md", documentRendered: "L001 | # Doc",
      criteriaMarkdown: "- [CRIT-A] keep small", expectedCriterionIds: ["CRIT-A"],
      expectedRequirementIds: []
    });
    expect(user).toContain("<<<DOCUMENT");
    expect(user).toContain("<<<CRITERIA");
    expect(user).toContain("- [CRIT-A] keep small");
    expect(user).toContain("CRIT-A");
    expect(user).toContain("L001 | # Doc");
  });
  it("includes prior spec, prior findings, and prior responses when present", () => {
    const user = buildUserPrompt({
      documentPath: "plan.md", documentRendered: "L001 | plan", criteriaMarkdown: "- [CRIT-A] x",
      expectedCriterionIds: ["CRIT-A"], expectedRequirementIds: ["REQ-AUTH"],
      priorSpecPath: "spec.md", priorSpecRendered: "L001 | spec",
      priorFindings: [{ id: "F1", status: "new", severity: "HIGH", disposition: "required",
        category: "x", claim: "c", where: { path: "plan.md", startLine: 1, endLine: 1 },
        fix: "f", completionCondition: "d", supersededByFindingIds: [] }],
      priorResponses: [{ findingId: "F1", response: "rejected_with_evidence", evidence: "see L1" }]
    });
    expect(user).toContain("<<<PRIOR_SPEC");
    expect(user).toContain("<<<PRIOR_LOG");
    expect(user).toContain("REQ-AUTH");
    expect(user).toContain("F1");
    expect(user).toContain("rejected_with_evidence");
  });
});
