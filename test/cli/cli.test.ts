// CLI scope: `review` (now persisting via reviewDocument) + `compare` (stateless) + `respond`.
// Plan stage / --prior / --prior-approval wired in P3-T4.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { main, type CliIO } from "../../src/cli/index.js";
import type { ReviewerProvider, ReviewResult, ProviderSpec } from "../../src/core/types.js";
import { writeRoundOnce, readRound } from "../../src/core/persistence.js";
import { sha256 } from "../../src/core/hash.js";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const approved: ReviewResult = {
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
  upstreamCoverage: [], findings: []
};
// plan-stage result: criteriaCoverage covers CRIT-A, upstreamCoverage covers REQ-X (all met)
const planGood: ReviewResult = {
  feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
  criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
  upstreamCoverage: [{ id: "REQ-X", assessment: "met", note: "", findingIds: [] }],
  findings: []
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
// A round-2 result that carries the prior F1 finding to a terminal status (so carry-forward passes).
const resolvedFor = (docPath: string): ReviewResult => ({
  ...approved,
  findings: [{ id: "F1", status: "resolved", severity: "HIGH", disposition: "required", category: "x",
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
  mintLineageId: () => "L1",
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

const reviewArgs = (extra: string[]) =>
  [doc, "--stage", "spec", "--criteria", crit, "--reviewer-provider", "openai", "--reviewer-model", "gpt",
   "--author-provider", "anthropic", "--author-model", "claude", ...extra];

describe("cli review persistence + lineage", () => {
  it("writes an immutable round-1 artifact under --out", async () => {
    const o = io();
    const code = await main(reviewArgs(["--out", join(dir, "out")]), { OPENAI_API_KEY: "k" }, o, deps(approved));
    expect(code).toBe(0);
    expect(existsSync(join(dir, "out", "L1", "round-1.json"))).toBe(true);
  });

  it("refuses a second review without --prior-log/--new-lineage once a round exists", async () => {
    await main(reviewArgs(["--out", join(dir, "out")]), { OPENAI_API_KEY: "k" }, io(), deps(approved));
    const o = io();
    const code = await main(reviewArgs(["--out", join(dir, "out")]), { OPENAI_API_KEY: "k" }, o, deps(approved));
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/prior-log|new-lineage/i);
  });

  it("writes a --prior-log continuation next to its parent even when --out is omitted", async () => {
    const OUT = join(dir, "out");
    await main(reviewArgs(["--out", OUT]), { OPENAI_API_KEY: "k" }, io(), deps(changesFor(doc)));
    const roundPath = join(OUT, "L1", "round-1.json");
    const respFile = join(dir, "resp.json");
    await writeFile(respFile, JSON.stringify([{ findingId: "F1", response: "accepted_and_revised" }]));
    await main(["respond", "--round", roundPath, "--responses", respFile], {}, io(), deps(approved));
    // NOTE: no --out here — the continuation must still land beside its parent, not in doc.review
    const code = await main(reviewArgs(["--prior-log", roundPath]), { OPENAI_API_KEY: "k" }, io(), deps(resolvedFor(doc)));
    expect(code).toBe(0);
    expect(existsSync(join(OUT, "L1", "round-2.json"))).toBe(true);
    expect(existsSync(join(dir, "spec.md.review"))).toBe(false);
  });

  it("rejects --out that disagrees with the --prior-log lineage directory", async () => {
    const OUT = join(dir, "out");
    await main(reviewArgs(["--out", OUT]), { OPENAI_API_KEY: "k" }, io(), deps(changesFor(doc)));
    const roundPath = join(OUT, "L1", "round-1.json");
    const respFile = join(dir, "resp.json");
    await writeFile(respFile, JSON.stringify([{ findingId: "F1", response: "accepted_and_revised" }]));
    await main(["respond", "--round", roundPath, "--responses", respFile], {}, io(), deps(approved));
    const o = io();
    const code = await main(reviewArgs(["--prior-log", roundPath, "--out", join(dir, "elsewhere")]),
      { OPENAI_API_KEY: "k" }, o, deps(resolvedFor(doc)));
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/--out|prior-log/i);
  });

  it("drives review -> respond -> re-run with --prior-log (round 2 carries the prior finding)", async () => {
    // round 1: changes_requested with one active finding F1
    const c1 = await main(reviewArgs(["--out", join(dir, "out")]), { OPENAI_API_KEY: "k" }, io(), deps(changesFor(doc)));
    expect(c1).toBe(1);
    const roundPath = join(dir, "out", "L1", "round-1.json");

    // finalize author responses for F1
    const respFile = join(dir, "resp.json");
    await writeFile(respFile, JSON.stringify([{ findingId: "F1", response: "accepted_and_revised" }]));
    const cr = await main(["respond", "--round", roundPath, "--responses", respFile], {}, io(), deps(approved));
    expect(cr).toBe(0);

    // round 2 via --prior-log: reviewer now reports F1 resolved (terminal) -> approved
    const resolved: ReviewResult = {
      ...approved,
      findings: [{ id: "F1", status: "resolved", severity: "HIGH", disposition: "required", category: "x",
        claim: "c", where: { path: doc, startLine: 1, endLine: 1 }, fix: "f", completionCondition: "d",
        supersededByFindingIds: [] }]
    };
    const o = io();
    const c2 = await main(reviewArgs(["--out", join(dir, "out"), "--prior-log", roundPath]), { OPENAI_API_KEY: "k" }, o, deps(resolved));
    expect(c2).toBe(0);
    expect(existsSync(join(dir, "out", "L1", "round-2.json"))).toBe(true);
    const round2 = JSON.parse(await readFile(join(dir, "out", "L1", "round-2.json"), "utf8"));
    expect(round2.parent_round_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(round2.parent_responses_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Lay down an approved stage:spec round for the prior (up.md) so plan-stage tests can resolve it.
async function setupApprovedPrior(dir: string): Promise<{ upPath: string }> {
  const upText = "- [REQ-X] a requirement\n";
  const upPath = join(dir, "up.md");
  await writeFile(upPath, upText);
  const specCriteriaText = "- [CRIT-A] keep small\n";
  writeRoundOnce(`${upPath}.review`, "S1", 1, {
    schemaVersion: 1, round: 1, lineageId: "S1",
    timestamp: "2026-06-22T00:00:00Z", stage: "spec",
    author: { provider: "openai", model: "gpt" },
    reviewer: { provider: "openai", model: "gpt" },
    document_sha256: sha256(upText),
    criteria_sha256: sha256(specCriteriaText),
    prior_document_sha256: null, parent_round_sha256: null,
    parent_responses_sha256: null, prior_approval_sha256: null,
    criteriaMeta: { "CRIT-A": { required: true } },
    requirementIds: [], verdict: "approved",
    result: {
      feasibility: "feasible", feasibilityRationale: "", feasibilityFindingIds: [],
      criteriaCoverage: [{ id: "CRIT-A", assessment: "met", note: "", findingIds: [] }],
      upstreamCoverage: [], findings: []
    }
  });
  return { upPath };
}

describe("cli plan stage", () => {
  it("plan-stage review approves and persists a plan round", async () => {
    const { upPath } = await setupApprovedPrior(dir);
    const outdir = join(dir, "plan-out");
    const o = io();
    const code = await main(
      [doc, "--stage", "plan", "--criteria", crit, "--prior", upPath,
       "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "anthropic", "--author-model", "claude",
       "--out", outdir],
      { OPENAI_API_KEY: "k" }, o, deps(planGood)
    );
    expect(code).toBe(0);
    const printed = JSON.parse(o.out.join(""));
    expect(printed.verdict).toBe("approved");
  });

  it("plan-stage review without --prior exits 2", async () => {
    const o = io();
    const code = await main(
      [doc, "--stage", "plan", "--criteria", crit,
       "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "anthropic", "--author-model", "claude"],
      { OPENAI_API_KEY: "k" }, o, deps(planGood)
    );
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/--prior/);
  });

  it("spec stage + --prior is rejected", async () => {
    const o = io();
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit, "--prior", join(dir, "up.md"),
       "--reviewer-provider", "openai", "--reviewer-model", "gpt",
       "--author-provider", "anthropic", "--author-model", "claude"],
      { OPENAI_API_KEY: "k" }, o, deps(approved)
    );
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/--prior/);
  });

  it("anthropic is accepted as the reviewer provider", async () => {
    // Registry-level resolution of anthropic is covered by P3-T1's registry.test.ts.
    // This test proves the CLI plumbs the reviewer identity into the persisted round.
    const outdir = join(dir, "anth-out");
    const o = io();
    const code = await main(
      [doc, "--stage", "spec", "--criteria", crit,
       "--reviewer-provider", "anthropic", "--reviewer-model", "claude",
       "--author-provider", "openai", "--author-model", "gpt",
       "--out", outdir],
      { ANTHROPIC_API_KEY: "k" }, o, deps(approved)
    );
    expect(code).toBe(0);
    const roundPath = join(outdir, "L1", "round-1.json");
    const round = readRound(roundPath);
    expect(round.reviewer).toEqual({ provider: "anthropic", model: "claude" });
  });
});

describe("cli respond", () => {
  it("finalizes the responses sidecar and exits 0", async () => {
    await main(reviewArgs(["--out", join(dir, "out")]), { OPENAI_API_KEY: "k" }, io(), deps(changesFor(doc)));
    const roundPath = join(dir, "out", "L1", "round-1.json");
    const respFile = join(dir, "resp.json");
    await writeFile(respFile, JSON.stringify([{ findingId: "F1", response: "accepted_and_revised" }]));
    const o = io();
    const code = await main(["respond", "--round", roundPath, "--responses", respFile], {}, o, deps(approved));
    expect(code).toBe(0);
    const sidecar = JSON.parse(await readFile(roundPath.replace(/\.json$/, ".responses.json"), "utf8"));
    expect(sidecar.finalized).toBe(true);
  });

  it("rejects --responses - (stdin not supported in v1)", async () => {
    const o = io();
    const code = await main(["respond", "--round", join(dir, "x", "round-1.json"), "--responses", "-"], {}, o, deps(approved));
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/stdin|file path/i);
  });

  it("rejects a --responses file that is not a JSON array (clear error, not a raw TypeError)", async () => {
    await main(reviewArgs(["--out", join(dir, "out")]), { OPENAI_API_KEY: "k" }, io(), deps(changesFor(doc)));
    const roundPath = join(dir, "out", "L1", "round-1.json");
    const respFile = join(dir, "resp.json");
    await writeFile(respFile, JSON.stringify({ findingId: "F1", response: "accepted_and_revised" })); // object, not array
    const o = io();
    const code = await main(["respond", "--round", roundPath, "--responses", respFile], {}, o, deps(approved));
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/array/i);
  });

  it("rejects --round/--responses on the review path (only valid with the respond subcommand)", async () => {
    const o = io();
    const code = await main(reviewArgs(["--out", join(dir, "out"), "--responses", join(dir, "resp.json")]),
      { OPENAI_API_KEY: "k" }, o, deps(approved));
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/respond/i);
  });

  it("rejects --out on respond (exit 2, no sidecar written)", async () => {
    await main(reviewArgs(["--out", join(dir, "out")]), { OPENAI_API_KEY: "k" }, io(), deps(changesFor(doc)));
    const roundPath = join(dir, "out", "L1", "round-1.json");
    const respFile = join(dir, "resp.json");
    await writeFile(respFile, JSON.stringify([{ findingId: "F1", response: "accepted_and_revised" }]));
    const o = io();
    const code = await main(
      ["respond", "--round", roundPath, "--responses", respFile, "--out", join(dir, "elsewhere")],
      {}, o, deps(approved)
    );
    expect(code).toBe(2);
    expect(o.err.join("")).toMatch(/--out/);
    expect(existsSync(roundPath.replace(/\.json$/, ".responses.json"))).toBe(false);
  });
});
