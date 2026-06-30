#!/usr/bin/env node
// Lightweight review-quality runner. Fans a batch of specs out to one or more reviewer models via
// the built `review-doc` CLI (stateless compare mode) and renders the structured reviews as a
// readable Markdown report, so a human can eyeball whether the reviews are good.
//
// This is a SANITY-CHECK tool, NOT the frozen Phase-1 empirical gate
// (docs/superpowers/plans/phase-1-review-quality-validation.md): no run manifest, no seeded-defect
// ground truth, no adjudication, no pass/fail scoring. See eval/README.md.
//
// Usage:  npm run build  &&  node eval/see-quality.mjs <config.json>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CLI = join(REPO, "dist", "cli", "index.js");

// ── pure rendering (unit-tested; no I/O) ─────────────────────────────────────
function tally(coverage) {
  const t = { met: 0, partial: 0, not_met: 0, not_applicable: 0 };
  for (const c of coverage ?? []) if (c.assessment in t) t[c.assessment]++;
  return t;
}

function renderFinding(f) {
  const loc = `${f.where?.path}:${f.where?.startLine}-${f.where?.endLine}`;
  return [
    `- **${f.severity}** · ${f.disposition} · ${f.category} — "${f.claim}"`,
    `  - at \`${loc}\``,
    `  - fix: ${f.fix}`
  ].join("\n");
}

function renderEntry(e) {
  const r = e.result ?? {};
  const cc = tally(r.criteriaCoverage);
  const uc = tally(r.upstreamCoverage);
  const lines = [
    `#### ${e.provider}:${e.model}`,
    ``,
    `- **verdict:** ${e.verdict}`,
    `- **feasibility:** ${r.feasibility}${r.feasibilityRationale ? ` — ${r.feasibilityRationale}` : ""}`,
    `- **criteria coverage:** met ${cc.met} · partial ${cc.partial} · not_met ${cc.not_met} · not_applicable ${cc.not_applicable}`
  ];
  if ((r.upstreamCoverage ?? []).length)
    lines.push(`- **upstream coverage:** met ${uc.met} · partial ${uc.partial} · not_met ${uc.not_met} · not_applicable ${uc.not_applicable}`);
  const findings = r.findings ?? [];
  lines.push(``, `**Findings (${findings.length}):**`);
  lines.push(findings.length ? findings.map(renderFinding).join("\n") : "_none_");
  return lines.join("\n");
}

export function renderReport(run) {
  const { config: cfg, specResults } = run;
  const out = [
    `# Review-quality report`,
    ``,
    `- **run:** ${run.startedAt}`,
    `- **criteria:** \`${cfg.criteria}\``,
    `- **author:** ${cfg.author.provider}:${cfg.author.model}`,
    `- **reviewers:** ${cfg.reviewers.join(", ")}`,
    cfg.baseUrl ? `- **baseUrl:** ${cfg.baseUrl}` : null,
    cfg.allowSameModel ? `- **allowSameModel:** true` : null,
    ``,
    `> Sanity-check tool — not the frozen Phase-1 empirical gate (no scoring/adjudication).`,
    ``
  ].filter(l => l !== null);

  for (const sr of specResults) {
    out.push(`---`, ``, `## ${sr.spec}`, ``);
    if (sr.error) { out.push(`> ⚠️ **error:** ${sr.error}`, ``); continue; }
    for (const e of sr.entries ?? []) out.push(renderEntry(e), ``);
    const failures = sr.failures ?? [];
    if (failures.length) {
      out.push(`#### failures`, ``);
      for (const f of failures) out.push(`- **${f.provider}:${f.model}** — ${f.error}`);
      out.push(``);
    }
  }
  return out.join("\n");
}

// ── runner glue (untested side-effecting shim; mirrors src/cli/index.ts's entry shim) ─────────
function loadConfig(path) {
  let cfg;
  try { cfg = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { throw new Error(`cannot read config ${path}: ${e.message}`); }
  const need = ["criteria", "author", "reviewers", "specs"];
  for (const k of need) if (cfg[k] === undefined) throw new Error(`config missing required field: ${k}`);
  if (!cfg.author.provider || !cfg.author.model) throw new Error(`config.author needs { provider, model }`);
  if (!Array.isArray(cfg.reviewers) || cfg.reviewers.length === 0) throw new Error(`config.reviewers must be a non-empty array of "provider:model"`);
  if (!Array.isArray(cfg.specs) || cfg.specs.length === 0) throw new Error(`config.specs must be a non-empty array of paths`);
  for (const r of cfg.reviewers) if (!/^[^:]+:[^:]+$/.test(r)) throw new Error(`reviewer must be "provider:model", got "${r}"`);
  return cfg;
}

function runSpec(spec, cfg) {
  if (!existsSync(spec)) return { spec, error: `spec file not found: ${spec}`, entries: [], failures: [] };
  const [firstProvider, firstModel] = cfg.reviewers[0].split(":");
  const args = [
    CLI, spec, "--stage", "spec", "--criteria", cfg.criteria,
    "--author-provider", cfg.author.provider, "--author-model", cfg.author.model,
    "--reviewer-provider", firstProvider, "--reviewer-model", firstModel,   // required by the parser; compare ignores
    "--compare", cfg.reviewers.join(",")
  ];
  if (cfg.baseUrl) args.push("--reviewer-base-url", cfg.baseUrl);
  if (cfg.allowSameModel) args.push("--allow-same-model");

  const res = spawnSync("node", args, { encoding: "utf8", env: process.env });
  const stdout = (res.stdout ?? "").trim();
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout);
      return { spec, entries: parsed.entries ?? [], failures: parsed.failures ?? [] };
    } catch { /* fall through to error */ }
  }
  const why = (res.stderr ?? "").trim() || `CLI exited ${res.status} with no parseable output`;
  return { spec, error: why, entries: [], failures: [] };
}

function main(argv) {
  const configPath = argv[0];
  if (!configPath) { console.error("usage: node eval/see-quality.mjs <config.json>"); return 2; }
  if (!existsSync(CLI)) { console.error(`built CLI not found at ${CLI} — run \`npm run build\` first`); return 2; }

  let cfg;
  try { cfg = loadConfig(configPath); } catch (e) { console.error(e.message); return 2; }

  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const outDir = join(REPO, "eval", "runs", stamp);
  const rawDir = join(outDir, "raw");
  mkdirSync(rawDir, { recursive: true });

  const specResults = [];
  const seen = new Map();
  for (const spec of cfg.specs) {
    console.error(`reviewing ${spec} …`);
    const sr = runSpec(spec, cfg);
    specResults.push(sr);
    let name = basename(spec);
    if (seen.has(name)) { const n = seen.get(name) + 1; seen.set(name, n); name = `${name}.${n}`; }
    else seen.set(name, 0);
    writeFileSync(join(rawDir, `${name}.json`), JSON.stringify(sr, null, 2));
  }

  const run = { startedAt, config: cfg, specResults };
  const reportPath = join(outDir, "report.md");
  writeFileSync(reportPath, renderReport(run));
  console.error(`\nreport: ${reportPath}`);
  return 0;
}

// Entry guard: run only when invoked directly, not when imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
