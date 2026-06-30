# Design: `eval/see-quality` — lightweight review-quality runner

**Date:** 2026-06-30
**Status:** approved (brainstorm)

## Purpose

With real API keys, fan a batch of specs out to one or more reviewer models and render the
structured reviews as a readable Markdown report — so a human can eyeball whether the reviews are
actually good. This is a **sanity-check tool**, deliberately *not* the frozen empirical gate
defined in `docs/superpowers/plans/phase-1-review-quality-validation.md` (no run-id manifest, no
seeded-defect ground truth, no adjudication, no pass/fail scoring). It is the "look credible
first" step before anyone invests in the full frozen machinery.

## Non-goals (YAGNI)

- No scoring / thresholds / precision-detection metrics.
- No seeded-defect manifest or adjudication NDJSON.
- No persistence, lineage, or round artifacts (uses stateless compare).
- No plan-stage review (spec stage only — judge spec-review quality first).
- A single OpenAI-compatible `baseUrl` is shared across compare targets (matches the CLI). To
  test a different endpoint, run again with a different `baseUrl`.

## Form

A single **zero-dependency Node ESM script**: `eval/see-quality.mjs`, run as:

```bash
npm run build                       # the runner shells out to the built CLI
node eval/see-quality.mjs <config.json>
```

It exercises the **real product** by shelling out to the built `review-doc` CLI rather than
importing core, so the report reflects exactly what the shipped tool produces. Credentials come
from the environment or a `.env` file (already supported by the CLI).

## Input — `config.json`

```json
{
  "criteria": "eval/criteria.spec.md",
  "author":   { "provider": "anthropic", "model": "claude-opus-4-8" },
  "reviewers": ["openai:gpt-5.4", "anthropic:claude-sonnet-4-6"],
  "allowSameModel": false,
  "baseUrl":  "https://optional-openai-compatible/v1",
  "specs":    ["specs/a.md", "specs/b.md"]
}
```

- `reviewers` are `provider:model` strings (the CLI `--compare` format).
- Cross-model rule (enforced by the CLI): a reviewer may share the author's **provider** as long
  as the **model** differs; identical `provider:model` is rejected unless `allowSameModel: true`
  (maps to `--allow-same-model`).
- `baseUrl` and `allowSameModel` are optional. Missing `criteria`/`author`/`reviewers`/`specs`,
  or an empty list, is a config error (fail fast with a clear message).

## Mechanism

For each spec, invoke the built CLI once in **compare** mode (stateless, writes no artifacts):

```
node dist/cli/index.js <spec> --stage spec --criteria <criteria> \
  --author-provider <p> --author-model <m> \
  [--reviewer-base-url <baseUrl>] [--allow-same-model] \
  --compare <reviewer1,reviewer2,...>
```

The CLI validates `--reviewer-provider`/`--reviewer-model` as required *before* it reaches the
compare branch (even though compare ignores them for fan-out). The runner therefore passes the
**first** reviewer's `provider`/`model` as those two flags to satisfy the parser. Parse stdout as
`{ entries, failures }`:
- `entries[i]` = `{ provider, model, verdict, result }` for a reviewer that returned a valid review.
- `failures[i]` = `{ provider, model, error }` for one that errored (HTTP, invalid output, etc.).

A non-zero CLI exit with no parseable stdout (e.g. a usage error, or all reviewers failed) is
recorded as a spec-level error in the report; the run continues to the next spec.

## Output — `eval/runs/<timestamp>/`

`<timestamp>` is an ISO-like, filesystem-safe stamp computed once at startup.

- **`report.md`** — the human-facing artifact. Structure:
  - Run header: timestamp, criteria path, author identity, reviewer list.
  - Per spec (a section): the spec path; then per reviewer model a sub-section with
    **verdict**, **feasibility** + rationale, a **criteria-coverage tally** (met / partial /
    not_met / not_applicable counts), and a **findings** list — each finding rendered as
    `SEVERITY · disposition · "claim" · path:startLine-endLine` followed by the `fix`. Reviewer
    **failures** are listed with their error. Spec-level errors are called out at the section top.
- **`raw/<specName>.json`** — the raw `{ entries, failures }` (or the error) per spec, for
  diffing / re-rendering / deeper inspection. `<specName>` is the spec's basename
  (collision-disambiguated with an index if two specs share a basename).

## Components & boundaries

- **`renderReport(run)` — pure function.** Input: a structured run object (config metadata +
  per-spec results, each holding parsed `entries`/`failures` or an error). Output: the Markdown
  string. No I/O. This is the unit that is **unit-tested** (feed canned compare output, assert the
  Markdown contains the verdict, the finding claim, the location, and the failure line) — so the
  rendering is verified without any network or API key.
- **runner glue (untested, like the CLI shim).** Reads/validates the config, computes the
  timestamp, builds the argv, spawns the CLI per spec, collects results, calls `renderReport`,
  writes the files. Side-effecting; mirrors the "untested entry shim" pattern already used in
  `src/cli/index.ts`.

## Error handling

| Condition | Behaviour |
|-----------|-----------|
| Config missing required field / empty `specs` or `reviewers` | Fail fast, exit non-zero, clear message. |
| `dist/cli/index.js` absent (not built) | Fail fast: "run `npm run build` first". |
| A spec file does not exist | Skip that spec, record a spec-level error in the report, continue. |
| One reviewer errors (key/HTTP/invalid output) | Appears under that spec's **failures**; other reviewers still reported. |
| CLI exits non-zero with no parseable stdout | Spec-level error; continue to next spec. |

Missing API keys surface naturally as reviewer failures (the CLI emits e.g. `OPENAI_API_KEY is
not set`), which the report shows — no special handling needed.

## Files

- `eval/see-quality.mjs` — the runner + `renderReport`.
- `eval/criteria.spec.md` — a starter spec-review criteria file (may reuse `examples/criteria.spec.md`).
- `eval/see-quality.config.example.json` — a copyable config template.
- `eval/README.md` — how to run it + how it relates to (and differs from) the frozen Phase-1 gate.
- `test/eval/see-quality.test.ts` — unit test for `renderReport` (canned data, no network).
- `eval/runs/` — gitignored output directory.

## Testing

- **Unit:** `renderReport` against canned `{entries, failures}` — asserts the Markdown surfaces
  verdict, feasibility, a finding's severity/claim/location/fix, and a failure entry. Runs in the
  normal `npm test` suite (no network).
- **Manual (needs keys):** run against ≥1 real spec with ≥1 reachable reviewer; confirm
  `report.md` renders and a deliberately bad spec draws findings.
