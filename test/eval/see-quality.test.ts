import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM script, no type declarations
import { renderReport } from "../../eval/see-quality.mjs";

const run = {
  startedAt: "2026-06-30T12:00:00Z",
  config: {
    criteria: "eval/criteria.spec.md",
    author: { provider: "anthropic", model: "claude-opus-4-8" },
    reviewers: ["openai:gpt-5.4", "anthropic:claude-sonnet-4-6"],
    baseUrl: undefined,
    allowSameModel: false
  },
  specResults: [
    {
      spec: "specs/good.md",
      entries: [
        {
          provider: "openai", model: "gpt-5.4", verdict: "changes_requested",
          result: {
            feasibility: "feasible_with_conditions", feasibilityRationale: "needs an auth section",
            feasibilityFindingIds: ["F1"],
            criteriaCoverage: [
              { id: "CRIT-SCOPE", assessment: "met", note: "", findingIds: [] },
              { id: "CRIT-AUTH", assessment: "not_met", note: "", findingIds: ["F1"] }
            ],
            upstreamCoverage: [],
            findings: [{
              id: "F1", status: "new", severity: "HIGH", disposition: "required", category: "security",
              claim: "No authentication flow is described", where: { path: "specs/good.md", startLine: 12, endLine: 18 },
              fix: "Add an auth section covering sign-in and session expiry", completionCondition: "auth section exists",
              supersededByFindingIds: []
            }]
          }
        }
      ],
      failures: [{ provider: "anthropic", model: "claude-sonnet-4-6", error: "Anthropic HTTP 429: rate limited" }]
    },
    { spec: "specs/missing.md", error: "spec file not found", entries: [], failures: [] }
  ]
};

describe("renderReport", () => {
  const md = renderReport(run);

  it("renders the run header (author + reviewers + criteria)", () => {
    expect(md).toContain("claude-opus-4-8");
    expect(md).toContain("openai:gpt-5.4");
    expect(md).toContain("eval/criteria.spec.md");
  });
  it("renders each spec section", () => {
    expect(md).toContain("specs/good.md");
    expect(md).toContain("specs/missing.md");
  });
  it("renders the reviewer verdict and feasibility", () => {
    expect(md).toContain("changes_requested");
    expect(md).toContain("feasible_with_conditions");
    expect(md).toContain("needs an auth section");
  });
  it("renders each finding with severity, claim, location, and fix", () => {
    expect(md).toContain("HIGH");
    expect(md).toContain("No authentication flow is described");
    expect(md).toContain("specs/good.md:12-18");
    expect(md).toContain("Add an auth section covering sign-in and session expiry");
  });
  it("renders a criteria-coverage tally", () => {
    expect(md).toMatch(/met/);
    expect(md).toMatch(/not_met/);
  });
  it("renders reviewer failures with the model and error", () => {
    expect(md).toContain("claude-sonnet-4-6");
    expect(md).toContain("Anthropic HTTP 429: rate limited");
  });
  it("renders a spec-level error", () => {
    expect(md).toContain("spec file not found");
  });
});
