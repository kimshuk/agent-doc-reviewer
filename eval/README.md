# `eval/` — review-quality tooling

## `see-quality.mjs` — lightweight quality runner

Fans a batch of specs out to one or more reviewer models and renders the structured reviews as a
readable Markdown report, so you can **eyeball whether the reviews are actually good**. It shells
out to the built `review-doc` CLI (stateless compare mode), so the report reflects exactly what the
shipped tool produces.

### Run

```bash
npm run build                                  # the runner uses dist/cli/index.js
cp eval/see-quality.config.example.json my-run.json   # edit it
node eval/see-quality.mjs my-run.json
```

Credentials come from the environment or a `.env` file (the CLI loads `.env` automatically; see
the repo `.env.example`). You need a key for each reviewer provider you list.

### Config

```json
{
  "criteria":  "examples/criteria.spec.md",
  "author":    { "provider": "anthropic", "model": "claude-opus-4-8" },
  "reviewers": ["openai:gpt-5.4", "anthropic:claude-sonnet-4-6"],
  "allowSameModel": false,
  "baseUrl":   null,
  "specs":     ["eval/samples/sample-spec.md"]
}
```

- `reviewers` — `provider:model` strings, fanned out per spec in one compare call.
- A reviewer may share the **author's provider** as long as the **model differs**; identical
  `provider:model` needs `"allowSameModel": true`.
- `baseUrl` — optional OpenAI-compatible endpoint override (shared across compare targets; to test
  a different endpoint, run again with a different value). `null` or omitted = provider default.

### Output

Writes `eval/runs/<timestamp>/` (gitignored):

- `report.md` — per spec, per reviewer: verdict, feasibility, criteria-coverage tally, and each
  finding (severity · disposition · claim · `path:line` · fix). Reviewer/HTTP errors appear under
  **failures**; a missing spec is a spec-level error. The run never aborts on one failure.
- `raw/<spec>.json` — the raw `{ entries, failures }` per spec for diffing / re-rendering.

## What this is NOT

This is a **sanity check**, not the frozen Phase-1 empirical gate
(`docs/superpowers/plans/phase-1-review-quality-validation.md`). It has **no** run manifest, **no**
seeded-defect ground truth, **no** adjudication, and **no** pass/fail scoring. Use it to decide
whether the reviews look credible before anyone invests in the full frozen-run machinery.
