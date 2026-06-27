import { describe, it, expect, vi } from "vitest";
import { runReview } from "../../src/core/review.js";
import { ValidationError } from "../../src/core/errors.js";
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
const baseArgs = (provider: ReviewerProvider) => ({
  provider, system: "S", user: "U", model: "m", ctx, criteriaMeta: ctx.criteriaMeta
});

describe("runReview", () => {
  it("returns result + verdict on a first-pass valid response", async () => {
    const provider: ReviewerProvider = { name: "mock", review: vi.fn().mockResolvedValue(good) };
    const out = await runReview(baseArgs(provider));
    expect(out.verdict).toBe("approved");
    expect(provider.review).toHaveBeenCalledTimes(1);
  });
  it("repairs once: bad then good, passing prior output + errors", async () => {
    const review = vi.fn()
      .mockResolvedValueOnce({ findings: "not-an-array" })
      .mockResolvedValueOnce(good);
    const provider: ReviewerProvider = { name: "mock", review };
    const out = await runReview(baseArgs(provider));
    expect(out.verdict).toBe("approved");
    expect(review).toHaveBeenCalledTimes(2);
    const repairReq = review.mock.calls[1][0];
    expect(repairReq.priorInvalidOutput).toBeTypeOf("string");
    expect(repairReq.validationErrors).toBeTypeOf("string");
  });
  it("throws ValidationError when bad twice", async () => {
    const provider: ReviewerProvider = { name: "mock", review: vi.fn().mockResolvedValue({ findings: "bad" }) };
    await expect(runReview(baseArgs(provider))).rejects.toThrow(ValidationError);
  });
  it("treats a semantic failure (unknown criterion) as repairable", async () => {
    const semBad = { ...good, criteriaCoverage: [{ id: "CRIT-Z", assessment: "met", note: "", findingIds: [] }] };
    const review = vi.fn().mockResolvedValueOnce(semBad).mockResolvedValueOnce(good);
    await expect(runReview(baseArgs({ name: "m", review }))).resolves.toMatchObject({ verdict: "approved" });
    expect(review).toHaveBeenCalledTimes(2);
  });
});
