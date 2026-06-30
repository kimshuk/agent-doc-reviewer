import { describe, it, expect, beforeEach } from "vitest";
import { verifyApproval } from "../../src/core/approval.js";
import { writeRoundOnce, type RoundArtifact } from "../../src/core/persistence.js";
import { sha256 } from "../../src/core/hash.js";
import { UsageError } from "../../src/core/errors.js";
import type { ReviewResult } from "../../src/core/types.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const approvedResult: ReviewResult = {
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
  upstreamCoverage: [], findings: []
};
const art = (over: Partial<RoundArtifact>): RoundArtifact => ({
  schemaVersion: 1, round: 1, lineageId: "L1", timestamp: "T", stage: "spec",
  author: { provider: "anthropic", model: "a" }, reviewer: { provider: "openai", model: "o" },
  document_sha256: "0".repeat(64), criteria_sha256: "c".repeat(64), prior_document_sha256: null,
  parent_round_sha256: null, parent_responses_sha256: null, prior_approval_sha256: null,
  criteriaMeta: { "CRIT-A": { required: true } }, requirementIds: [],
  verdict: "approved", result: approvedResult, ...over
});

let dir = "", specPath = "", specDir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rd-"));
  specPath = join(dir, "spec.md");
  await writeFile(specPath, "# spec\n");
  specDir = join(dir, "spec.md.review");
});

describe("verifyApproval", () => {
  it("verifies a genuine approved spec round and returns its hash", async () => {
    writeRoundOnce(specDir, "L1", 1, art({ document_sha256: sha256("# spec\n") }));
    const out = await verifyApproval({ priorPath: specPath, priorReviewDir: specDir });
    expect(out.approvalSha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects when stored verdict was flipped to approved but recompute says otherwise", async () => {
    const tampered = art({
      document_sha256: sha256("# spec\n"), verdict: "approved",
      result: { ...approvedResult, criteriaCoverage: [{ id: "CRIT-A", assessment: "not_met", note: "", findingIds: ["F1"] }],
        findings: [{ id: "F1", status: "new", severity: "HIGH", disposition: "required", category: "x",
          claim: "c", where: { path: "spec.md", startLine: 1, endLine: 1 }, fix: "f",
          completionCondition: "d", supersededByFindingIds: [] }] }
    });
    writeRoundOnce(specDir, "L1", 1, tampered);
    await expect(verifyApproval({ priorPath: specPath, priorReviewDir: specDir })).rejects.toThrow(UsageError);
  });
  it("rejects when the document hash does not match --prior", async () => {
    writeRoundOnce(specDir, "L1", 1, art({ document_sha256: "f".repeat(64) }));   // valid-format but wrong hash
    await expect(verifyApproval({ priorPath: specPath, priorReviewDir: specDir })).rejects.toThrow(UsageError);
  });
  it("errors when no approved round exists", async () => {
    writeRoundOnce(specDir, "L1", 1, art({ document_sha256: sha256("# spec\n"), verdict: "changes_requested" }));
    await expect(verifyApproval({ priorPath: specPath, priorReviewDir: specDir })).rejects.toThrow(UsageError);
  });
  it("explicit --prior-approval is NOT a trust bypass: tampered artifact is still rejected", async () => {
    // Mirror the flipped-verdict fixture but pass the path DIRECTLY via approvalPath so the
    // explicit path is exercised (not the auto-locate path).
    const tampered = art({
      document_sha256: sha256("# spec\n"), verdict: "approved",
      result: { ...approvedResult, criteriaCoverage: [{ id: "CRIT-A", assessment: "not_met", note: "", findingIds: ["F1"] }],
        findings: [{ id: "F1", status: "new", severity: "HIGH", disposition: "required", category: "x",
          claim: "c", where: { path: "spec.md", startLine: 1, endLine: 1 }, fix: "f",
          completionCondition: "d", supersededByFindingIds: [] }] }
    });
    const tamperedPath = writeRoundOnce(specDir, "L1", 1, tampered);
    await expect(verifyApproval({ approvalPath: tamperedPath, priorPath: specPath, priorReviewDir: specDir }))
      .rejects.toThrow(UsageError);
  });
  it("errors when >1 lineage qualifies (ambiguous) but accepts an explicit --prior-approval", async () => {
    const a = writeRoundOnce(specDir, "L1", 1, art({ document_sha256: sha256("# spec\n") }));
    writeRoundOnce(specDir, "L2", 1, art({ lineageId: "L2", document_sha256: sha256("# spec\n") }));
    await expect(verifyApproval({ priorPath: specPath, priorReviewDir: specDir })).rejects.toThrow(UsageError);
    const out = await verifyApproval({ approvalPath: a, priorPath: specPath, priorReviewDir: specDir });
    expect(out.approvalSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
