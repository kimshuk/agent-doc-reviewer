// Phase-1 CLI scope (9 tests): `review` (stateless) + `compare` only.
// No `respond`, `--out`, `--prior`, persistence/lineage — those are Phase 2/3.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { main, type CliIO } from "../../src/cli/index.js";
import type { ReviewerProvider, ReviewResult, ProviderSpec } from "../../src/core/types.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const approved: ReviewResult = {
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
  upstreamCoverage: [], findings: []
};
// Findings must cite a path present in inputLineCounts (the doc) with in-range lines,
// per the frozen location-bounds check; the doc is a 2-line file written in beforeEach.
const changesFor = (docPath: string): ReviewResult => ({
  ...approved,
  criteriaCoverage: [{ id: "CRIT-A", assessment: "not_met", note: "", findingIds: ["F1"] }],
  findings: [{ id: "F1", status: "new", severity: "HIGH", disposition: "required", category: "x",
    claim: "c", where: { path: docPath, startLine: 1, endLine: 1 }, fix: "f", completionCondition: "d",
    supersededByFindingIds: [] }]
});
const provider = (res: ReviewResult): ReviewerProvider => ({ name: "openai", review: vi.fn().mockResolvedValue(res) });

function io(): CliIO & { out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = [];
  return { out, err, stdout: s => out.push(s), stderr: s => err.push(s) };
}

let dir = "", doc = "", crit = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rd-"));
  doc = join(dir, "spec.md"); await writeFile(doc, "# Title\nbody\n");
  crit = join(dir, "criteria.md"); await writeFile(crit, "- [CRIT-A] keep small\n");
});

const deps = (res: ReviewResult) => ({
  now: () => "2026-06-22T00:00:00Z",
  makeProvider: () => provider(res)
});

describe("cli review", () => {
  it("prints {verdict, result} and exits 0 on approved", async () => {
    const o = io();
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "anthropic", "--author-model", "claude"],
      { OPENAI_API_KEY: "k" }, o, deps(approved)
    );
    expect(code).toBe(0);
    const printed = JSON.parse(o.out.join(""));
    expect(printed.verdict).toBe("approved");
    expect(printed.result.findings).toEqual([]);
  });

  it("exits 1 on changes_requested", async () => {
    const o = io();
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "anthropic", "--author-model", "claude"],
      { OPENAI_API_KEY: "k" }, o, deps(changesFor(doc))
    );
    expect(code).toBe(1);
    expect(JSON.parse(o.out.join("")).verdict).toBe("changes_requested");
  });

  it("exits 2 on a usage error (missing --stage)", async () => {
    const o = io();
    const code = await main([doc, "--criteria", crit], { OPENAI_API_KEY: "k" }, o, deps(approved));
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/stage/i);
  });

  it("exits 2 when author identity is omitted (guard not silently defeated)", async () => {
    const o = io();
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt"],
      { OPENAI_API_KEY: "k" }, o, deps(approved)
    );
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/author/i);
  });

  it("exits 2 when author identity is omitted EVEN WITH --allow-same-model (override waives equality only)", async () => {
    const o = io();
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--allow-same-model"],
      { OPENAI_API_KEY: "k" }, o, deps(approved)
    );
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/author/i);
  });

  it("threads --reviewer-base-url into the provider env", async () => {
    const o = io();
    const seen: Array<Record<string, string | undefined>> = [];
    const makeProvider = (_spec: ProviderSpec, env: Record<string, string | undefined>) => {
      seen.push(env); return provider(approved);
    };
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "anthropic", "--author-model", "claude", "--reviewer-base-url", "https://custom/v1"],
      { OPENAI_API_KEY: "k" }, o, { now: () => "T", makeProvider }
    );
    expect(code).toBe(0);
    expect(seen[0]?.OPENAI_BASE_URL).toBe("https://custom/v1");
  });
});

describe("cli compare", () => {
  it("prints { entries, failures } for a spec-stage compare and exits 0", async () => {
    const o = io();
    const code = await main(
      // author differs from BOTH compare targets so the per-target guard passes
      [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "google", "--author-model", "gemini", "--compare", "openai:gpt,anthropic:claude"],
      { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }, o, deps(approved)
    );
    expect(code).toBe(0);
    const printed = JSON.parse(o.out.join(""));
    expect(printed.entries).toHaveLength(2);
    expect(printed.failures).toHaveLength(0);
  });

  it("exits 2 when a --compare target equals the author (per-target cross-model guard)", async () => {
    const o = io();
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "openai", "--author-model", "gpt", "--compare", "openai:gpt"],
      { OPENAI_API_KEY: "k" }, o, deps(approved)
    );
    expect(code).toBe(2);
  });

  it("rejects --prior-log combined with --compare (fresh-only)", async () => {
    const o = io();
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "anthropic", "--author-model", "claude",
       "--compare", "openai:gpt", "--prior-log", join(dir, "x", "round-1.json")],
      { OPENAI_API_KEY: "k" }, o, deps(approved)
    );
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/prior-log/i);
  });
});
