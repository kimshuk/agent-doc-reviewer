# Design Spec: `review-doc` — cross-model document reviewer

**Date:** 2026-06-22
**Status:** Draft — awaiting approval

## Purpose

A small cross-model document-review tool for a spec/plan authoring workflow. The
coding agent is the **author**; this tool sends the author's documents to a
**different** model for an independent critique, so the feedback isn't biased toward
the author model's own style.

This is a **CLI tool + a workflow skill** — not an app. No web server, no UI. The
review logic lives in a provider-agnostic **core library**; a thin CLI is the only
transport in v1. An MCP server is a possible second transport *later* — the core is
designed so adding it is trivial, but it is not built now.

## Locked decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Reviewer providers in v1 | **Anthropic + OpenAI only** (GLM/Gemini later via the OpenAI-compatible path) |
| Package layout | **Single npm package**, `src/core` + `src/cli` |
| `--criteria` file format | **Markdown prose, injected verbatim** into the prompt |
| Round persistence | **JSON files in a review dir next to the doc** |
| JSON output forcing | **Schema-strict + one repair retry + fail**, uniform across adapters |

---

## 1. Architecture & layout

Single npm package, TypeScript, ESM, Node 18+ (built-in `fetch`, built-in
`node:util parseArgs` — no arg-parser dependency). The **core** has zero knowledge of
`process` / argv / stdout / exit codes; the **CLI** is the only thing that touches
those. A later MCP server becomes a second transport that calls the same core
functions.

```
review-doc/
  src/
    core/
      index.ts          # public API barrel (the "library")
      types.ts          # Finding, Severity, ReviewResult, ReviewRequest
      schema.ts         # the CONSTANT JSON schema + ajv validator
      prompt.ts         # rubric (constant) + buildSystemPrompt / buildUserPrompt
      review.ts         # runReview: provider call -> validate -> repair -> verdict
      verdict.ts        # computeVerdict(findings)
      compare.ts        # runCompare: fan out across providers
      persistence.ts    # read/write <doc>.review/round-N.json
      providers/
        types.ts        # ReviewerProvider interface
        registry.ts     # selectProvider(name, model, env)
        openai.ts       # fetch-based, baseURL-parameterizable (GLM later = config)
        anthropic.ts    # fetch-based, forced tool-use
    cli/
      index.ts          # parseArgs -> core -> print JSON -> exit 0/1
  test/ ...
```

**Decision — adapters use raw `fetch`, not vendor SDKs.** Rationale: we explicitly
want to *own and assert* each request shape (the structured-output requirement);
`fetch` is trivial to mock (`vi.stubGlobal('fetch', ...)` — no real network); zero SDK
weight; and baseURL-parameterizing the OpenAI adapter for GLM-later is free.
Dependencies stay tiny: `typescript`, `vitest`, `ajv`.

---

## 2. Core interfaces & data flow

```ts
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface Finding {
  severity: Severity;
  claim: string;   // the concrete failure sequence, not a verdict
  where: string;   // line citation(s)
  fix: string;     // minimal fix or contract
}

interface ReviewRequest {
  system: string;
  user: string;
  schema: object;       // the CONSTANT output schema
  model: string;
  temperature: 0;
}

interface ReviewerProvider {
  name: string;
  review(req: ReviewRequest): Promise<unknown>;  // parsed-but-unvalidated JSON
}

interface ReviewResult {
  verdict: "approved" | "changes_requested";
  findings: Finding[];
}
```

**Division of labor.** The adapter owns exactly one model round-trip: building its own
request shape, forcing structured output, and mapping the response back to a plain
object. **Validation, the repair retry, and verdict computation live in core**
(`runReview`) so they are identical across providers — keeping the rubric and schema as
the clean control variable, with the provider as the only thing under test.

**Repair retry.** `runReview` validates the adapter's output against the schema with
ajv. On failure it re-calls `review()` once with a provider-agnostic instruction
appended to the user message: *"your previous JSON failed validation because
`<ajv error>`; return corrected JSON."* It validates again; on a second failure it
throws.

**Single-review flow:**

1. CLI parses args into a `ReviewInput`.
2. Core loads the doc, criteria, optional prior doc, and optional prior-log text.
3. `buildSystemPrompt(stage)` (rubric constant + stage) and `buildUserPrompt(...)`.
4. `selectProvider(provider, model, env)` returns the adapter.
5. `runReview`: `adapter.review(req)` -> validate -> [repair retry] -> `findings`.
6. `computeVerdict(findings)` -> verdict.
7. `persistence` writes `round-N.json`.
8. Return `{ verdict, findings }`. CLI prints JSON, exits `0` if `approved` else `1`.

---

## 3. CLI surface

```
review-doc <doc.md> --stage <spec|plan> --criteria <path> [options]

  <doc.md>            (positional) markdown doc under review
  --stage             spec | plan                          (required)
  --criteria <path>   markdown rubric, injected verbatim    (required)
  --prior <path>      approved upstream doc (e.g. the spec when reviewing the plan)
  --prior-log <path>  prior round's findings+responses JSON  (default: latest round in <doc>.review/)
  --provider <name>   openai | anthropic        (env REVIEWER_PROVIDER)
  --model <id>                                  (env REVIEWER_MODEL)
  --compare <list>    "anthropic:<model>,openai:<model>" -> run each, log side by side
  --out <dir>         review dir                (default: <doc>.review/ next to the doc)
```

**Micro-decisions made (please confirm or correct):**

- **(a) Flag casing:** kebab-case `--prior-log` (the original prompt wrote
  `--priorLog`).
- **(b) Output:** always print the `{ verdict, findings }` JSON object to stdout; exit
  `0` if `approved`, else `1`.
- **(c) API keys:** read from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (per-provider env
  vars). Missing key for the selected provider -> clear error before any network call.
- **(d) Compare mode is diagnostic:** it prints a JSON *array* of
  `{ provider, model, timestamp, verdict, findings }`, writes `round-N.compare.json`,
  and **always exits 0** (there is no single verdict to gate the exit code on).

---

## 4. The control variables (constant across providers)

These are deliberately identical for every provider — the provider is the variable
under test, the rubric and schema are the controls.

### Output JSON schema

The same constant is ajv-validated *and* handed to OpenAI's `json_schema` and
Anthropic's tool `input_schema`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["findings"],
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["severity", "claim", "where", "fix"],
        "properties": {
          "severity": { "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
          "claim": { "type": "string" },
          "where": { "type": "string" },
          "fix": { "type": "string" }
        }
      }
    }
  }
}
```

### Reviewer system prompt (encodes the distilled review discipline)

- Judge **only** against the provided criteria.
- Every finding: cite the line(s); explain the **concrete failure sequence** (not a
  verdict); give a **minimal fix or contract**; separate "fix the design" from "fix the
  wording/claim".
- Catch gaps between what the doc **claims** and what the mechanism actually
  **guarantees**.
- Reserve **CRITICAL/HIGH** for designs impossible/contradictory as written, or real
  races/ambiguities that cause wrong behavior. **MEDIUM/LOW** for precision/wording.
- **Approve** once the only remaining items are implementation-time checks — don't
  demand detail that belongs in the implementation plan, and don't gold-plate.
- Acknowledge which prior findings were resolved (given via `--prior-log`).
- `--stage` is passed in so the reviewer calibrates altitude: a `spec` is not docked
  for `plan`-level detail.

### Verdict (computed in code, never by the model)

`approved` iff no `CRITICAL` and no `HIGH` findings remain; otherwise
`changes_requested`. Temperature is `0` for every call.

---

## 5. Structured-output forcing, per adapter

- **OpenAI:** `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`,
  `temperature: 0`. Parse the message content as JSON, return `{ findings }`.
- **Anthropic:** a single `tool` whose `input_schema` is the schema, with
  `tool_choice: { type: "tool", name }` (forced), `temperature: 0`. Map the
  `tool_use.input` block to `{ findings }`.

Both return the plain object to core for uniform validation, repair, and verdict.

The OpenAI adapter is parameterized by `baseURL` (default OpenAI). A future GLM /
Gemini-compatible provider is added as **config, not new adapter code**, satisfying the
"design so adding a provider is trivial" requirement.

---

## 6. Persistence layout

Each run writes to a review dir next to the doc (default `<doc>.review/`,
overridable with `--out`):

```
<doc>.review/
  round-1.json          # { provider, model, timestamp, verdict, findings, responses }
  round-2.json
  round-1.compare.json  # array of per-provider results (compare mode)
```

- `findings` is the model output; `responses` is the author's per-finding decision
  (valid -> revised, or a one-line rebuttal) recorded by the skill loop.
- `--prior-log` defaults to the latest `round-N.json` in the review dir, so re-runs
  automatically feed the previous round's findings + responses back to the reviewer.

---

## 7. Skill: `review-loop` workflow

A `SKILL.md` that drives the iteration loop:

1. Author (the coding agent) writes/edits the doc.
2. Run `review-doc` -> `{ verdict, findings }`, persisted as `round-N`.
3. For each finding, decide if it is valid:
   - valid -> **revise the doc**;
   - not valid -> **record a one-line rebuttal**.
4. Persist `{ findings, responses }` into that round's JSON.
5. Re-run with `--prior-log <that round>`.
6. Stop at `approved` or after `MAX_ROUNDS` (default **3**).
7. **Hand to the user for sign-off.**
8. Only after sign-off, advance `spec` -> `plan`.

**Decision:** the skill is authored in-repo at `skills/review-loop/SKILL.md`; it can be
installed or symlinked into `~/.claude/skills`.

---

## 8. Testing (TDD — failing tests first, every provider mocked, no real network)

Runner: `vitest`. Coverage:

- **Schema:** validates good output; rejects each malformed shape.
- **Repair retry:** bad-then-good succeeds; bad-then-bad throws.
- **Verdict:** any CRITICAL/HIGH -> `changes_requested`; only MEDIUM/LOW or empty ->
  `approved`.
- **Prompt builders:** include the criteria verbatim, the stage, the prior doc, and the
  prior-log; the system prompt contains the rubric bullets.
- **Registry:** selects the adapter by name/env; missing key -> clear error.
- **Adapters:** against a stubbed `fetch`, assert the exact request shape (OpenAI
  `response_format` json_schema; Anthropic forced `tool_choice`) and that a canned
  response maps to `findings`.
- **Persistence:** round-trips `round-N.json`; resolves "latest" correctly.
- **Compare:** fans out to N mocked providers; aggregates with provider/model/timestamp.
- **CLI:** integration with a mocked core/provider — asserts exit `0`/`1` and the
  printed JSON.

---

## 9. Out of scope for v1 (explicit YAGNI)

- MCP server transport (core is designed for it; not built).
- Plugin packaging.
- GLM / Gemini adapters (the OpenAI-compatible path is reserved; not wired).
- Any web server or UI.
