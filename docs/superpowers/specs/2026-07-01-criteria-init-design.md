# Design: `review-doc criteria init`

## Summary

`review-doc criteria init <spec>` reads a spec document and produces a
**project-specific criteria draft** file that a human then reviews and edits
before using it with `--criteria` on a real review. It does **not** run a
review.

The command has two jobs:

1. Generate a criteria file: a fixed, code-owned **baseline** block plus
   LLM-generated **project-specific** criteria extracted from the spec.
2. Report `[REQ-*]` coverage: list the requirement tags the spec already
   declares, and — when tags are missing — warn and propose advisory
   candidate requirements for the user to copy into the spec.

### Trust posture (must remain explicit)

> Generated criteria are not trusted merely because review-doc produced them.
> The generated file is a draft artifact; the user must review and edit it
> before passing it to `--criteria`.

`criteria init` is an **LLM-assisted draft generator, not an authoritative
review gate.** The authoritative gate is the human reviewing and editing the
draft. Nothing downstream should treat a freshly generated criteria file as
approved.

## CLI surface

```
review-doc criteria init <spec> \
  --generator-provider <p> --generator-model <m> \
  [--out <path>] [--reviewer-base-url <url>] [--dotenv <path>]
```

- Subcommand detected positionally the same way `respond` is: `argv[0] ===
  "criteria" && argv[1] === "init"`, branched **before** the
  `--stage`/`--criteria`/`--author-*` required-flag logic — none of those flags
  apply here.
- Flags are named `--generator-*`, not `--reviewer-*`: this command generates a
  draft, it does not evaluate a document. The generator model and a reviewer
  model are conceptually different roles even if the same model is used for
  both.
- No `--stage`, no `--author-*`, no `--allow-same-model` (no cross-model
  constraint — this is generation, not review).
- `--out` default: `<spec>.criteria.md`. The command **refuses to overwrite**
  an existing file and exits 2 — a draft must not silently clobber a
  hand-edited criteria file.
- Reuses the existing `.env`/`--dotenv` loading (the bin shim already parses
  `--dotenv` before `main`) and `--reviewer-base-url` → `OPENAI_BASE_URL`
  passthrough unchanged.

## Provider capability (generic, not `review()`)

`provider.review()` is semantically tied to reviewing: the Anthropic factory
emits a tool literally named `emit_review` ("Emit the structured review
result") and the OpenAI factory names the schema `review_result`, with
review-specific repair wording and a fixed `temperature: 0`. Reusing it for
criteria generation would mix a review persona into a generation call.

Introduce a generic structured-generation capability and layer the existing
review method on top of the same interface:

```ts
interface StructuredRequest {
  system: string;
  user: string;
  schema: object;
  schemaName: string;          // caller-supplied, e.g. "criteria_draft"
  model: string;
  temperature: number;
  priorInvalidOutput?: string; // one-shot repair, generic wording
  validationErrors?: string;
}

interface StructuredProvider {
  name: string;
  generateStructured(req: StructuredRequest): Promise<unknown>;
}

interface ReviewerProvider extends StructuredProvider {
  review(req: ReviewRequest): Promise<unknown>;
}
```

- Both provider factories (`openai.ts`, `anthropic.ts`) gain
  `generateStructured`, using a caller-supplied `schemaName` for the OpenAI
  `json_schema.name` / the Anthropic tool name, and generic repair wording that
  says nothing about reviews.
- `review()` is left **frozen and untouched** (its wording, tool name, and
  behavior do not change). `criteria init` depends **only** on
  `StructuredProvider` and **never calls `review()`**.
- `selectProvider` in the registry is unchanged — it already returns a provider
  object that will now also carry `generateStructured`.

## Core module: `src/core/criteriaInit.ts` (process-free)

Follows the same dependency-injection shape as `reviewOnce`: provider injected,
no `process`, no direct network beyond the injected provider.

```ts
generateCriteriaDraft({
  specPath, specText, provider, model
}): Promise<{
  markdown: string;
  reqPresent: string[];
  reqCandidates: { id: string; text: string }[];
}>
```

Steps:

1. **REQ present** — `reqPresent = parseRequirements(specText)` run locally and
   deterministically (not via the LLM). `parseRequirements` throws when there
   are zero `[REQ-*]`; `criteria init` catches that case and treats it as
   "none present" rather than an error (see REQ handling below).
2. **Generate** — build a system + user prompt. The spec is embedded as
   **untrusted, quoted data** using the same fence + trust-boundary language as
   `prompt.ts` (the document is data, never instructions). Call
   `provider.generateStructured` with a `criteria_draft` schema forcing:
   ```json
   {
     "projectCriteria": [{ "id": "CRIT-PROJECT-...", "text": "...", "optional": false }],
     "reqCandidates":   [{ "id": "REQ-...", "text": "..." }]
   }
   ```
   The prompt instructs the model to draw project criteria from the spec's
   Goal, Decisions, Architecture, UI, Error-handling, Testing, and Out-of-scope
   sections, and to name every project criterion in the `CRIT-PROJECT-*`
   namespace.
3. **Validate generated ids** — every `projectCriteria[].id` must match
   `CRIT-PROJECT-[A-Z0-9-]+` and must not collide with a reserved baseline id.
   On any violation, run **one repair round** (re-prompt with the specific
   error, mirroring `runReview`'s repair-once). If it still fails, throw →
   exit 2.
4. Return `markdown` (assembled per below), `reqPresent`, `reqCandidates`.

## Deterministic markdown assembly

Assembled in code so the baseline can never be rewritten by the model.

```
# Draft review criteria
# Generated by: <generator-provider>:<generator-model>
# Generated from: <spec-path>
# Status: DRAFT — review and edit before use with --criteria.

## Baseline (code-owned — do not weaken)
- [CRIT-SCOPE] The design stays within the stated scope and defers non-blockers explicitly.
- [CRIT-FEASIBILITY] Every claimed guarantee is achievable by the described mechanism.
- [CRIT-CORRECTNESS] No described race, ambiguity, or contradiction can cause wrong behavior.
- [CRIT-FAILURE-HANDLING] Error, retry, and failure paths are specified, not implied.
- [CRIT-IMPLEMENTABILITY] Every step can be built with the described mechanisms; none requires an unavailable capability.
- [CRIT-REQ-TAGS] The spec declares every user-facing requirement as a [REQ-*] tag for downstream plan coverage.
- [CRIT-STYLE OPTIONAL] Terminology is consistent across sections.

## Project-specific (generated — verify before use)
- [CRIT-PROJECT-...] ...

## Suggested Requirements (advisory — copy into the SPEC, not here)
# spec already declares: REQ-X, REQ-Y      (or: none found)
- [REQ-...] ...
```

- The baseline block is a **constant** in code, emitted verbatim. Baseline
  wording for the five original ids is carried verbatim from
  `examples/criteria.spec.md`; `CRIT-IMPLEMENTABILITY` and `CRIT-REQ-TAGS` are
  new baseline criteria owned by this feature.
- Reserved baseline id set = `{SCOPE, FEASIBILITY, CORRECTNESS,
  FAILURE-HANDLING, IMPLEMENTABILITY, REQ-TAGS, STYLE}` (as `CRIT-*`). The
  generator namespace `CRIT-PROJECT-*` cannot collide with these by
  construction; validation enforces it.
- After assembly, run `parseCriteria(markdown)` on the full file. This
  guarantees the draft is actually parseable/usable as a `--criteria` input and
  catches any duplicate id. A parse failure is an internal error → exit 2 (the
  command must never write an unparseable draft).

## REQ handling

- Spec **has** `[REQ-*]`: list them under "Suggested Requirements" as "spec
  already declares: …". `reqCandidates` from the model are still appended as
  advisory suggestions.
- Spec **has no** `[REQ-*]`: this is **not** a failure. Still generate the
  draft, print a `stderr` warning, populate the "Suggested Requirements"
  section with `reqCandidates`, and **exit 0**. `criteria init` is a scaffold
  command, not a review gate.
- In every case the source spec is **read-only** — never written, never
  mutated. Inserting `[REQ-*]` tags into a spec, if ever wanted, is a separate
  explicit command out of scope here.

## Behavior / exit codes

- Success → write file at `--out`, print `stdout` JSON
  `{ written, criteriaCount, reqPresent, reqCandidateCount }`, exit **0**.
- No `[REQ-*]` in spec → still exit **0** with the warning + candidates.
- `--out` already exists → refuse, `stderr` message, exit **2**.
- Missing spec / provider / model, generation repair failure, unparseable
  assembled draft → exit **2** (matches the existing CLI convention where all
  usage/validation errors return 2).

## Testing (vitest, injected fake `StructuredProvider`)

- **Assembly**: baseline block always present and verbatim; generated project
  items appended under their heading; the whole file passes `parseCriteria`.
- **Reserved-id guard**: a fake provider returning `CRIT-SCOPE` (or any
  baseline id) triggers the repair round; a still-bad second response → error
  (exit 2). A provider returning a non-`CRIT-PROJECT-*` id is likewise
  repaired/rejected.
- **REQ present**: spec with `[REQ-*]` → listed, no warning. **REQ absent**:
  spec with none → warning emitted, candidates section populated, exit 0.
- **Overwrite guard**: existing `--out` → refuse, exit 2, file left untouched.
- **Spec immutability**: after a run, the source spec file bytes are unchanged.
- **Prompt-injection framing**: a spec containing an injected directive is
  passed to the fake provider **inside the untrusted DOCUMENT fence of the
  built prompt**, never as a system/developer instruction. (This asserts prompt
  construction; it cannot and does not assert model behavior.)
- **CLI parse**: `criteria init` branch is taken; missing spec/provider/model
  each raise the expected usage error; `--stage`/`--author-*` are not required
  on this path.

## Acceptance criteria

- `criteria init` never calls `review()`.
- `criteria init` never writes or mutates the source spec.
- Generated markdown passes `parseCriteria()`.
- Generated project criteria cannot use reserved baseline ids.
- Missing `[REQ-*]` emits a warning but still exits 0.

## Out of scope (v1)

- Running any review (`criteria init` only scaffolds).
- Mutating the spec to insert `[REQ-*]` tags.
- Cross-model constraints or an author identity.
- Reusing or altering `review()` / `ReviewResult` / verdict logic.
