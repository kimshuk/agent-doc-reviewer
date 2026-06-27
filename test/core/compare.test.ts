import { describe, it, expect, vi } from "vitest";
import { runCompare } from "../../src/core/compare.js";
import type { ReviewerProvider, ReviewResult } from "../../src/core/types.js";
import type { SemanticContext } from "../../src/core/semantics.js";

const good: ReviewResult = {
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
  upstreamCoverage: [], findings: []
};
const ctx: SemanticContext = {
  stage: "spec", mode: "full", criteriaMeta: { "CRIT-A": { required: true } },
  requirementIds: [], priorFindings: [], inputLineCounts: { "d.md": 5 }
};
const ok = (name: string): ReviewerProvider => ({ name, review: vi.fn().mockResolvedValue(good) });
const boom = (name: string): ReviewerProvider => ({ name, review: vi.fn().mockRejectedValue(new Error("nope")) });

describe("runCompare", () => {
  const common = { system: "S", user: "U", ctx, criteriaMeta: ctx.criteriaMeta, now: () => "T" };
  it("aggregates per-provider results with allSucceeded=true", async () => {
    const out = await runCompare({ ...common, entries: [
      { provider: ok("openai"), model: "gpt" }, { provider: ok("anthropic"), model: "claude" }
    ] });
    expect(out.allSucceeded).toBe(true);
    expect(out.entries.map(e => e.provider)).toEqual(["openai", "anthropic"]);
    expect(out.entries[0]).toMatchObject({ model: "gpt", timestamp: "T", verdict: "approved" });
  });
  it("records a failure and sets allSucceeded=false", async () => {
    const out = await runCompare({ ...common, entries: [
      { provider: ok("openai"), model: "gpt" }, { provider: boom("anthropic"), model: "claude" }
    ] });
    expect(out.allSucceeded).toBe(false);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toMatchObject({ provider: "anthropic", error: expect.stringContaining("nope") });
  });
});
