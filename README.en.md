**English** · [한국어](README.md)

# review-doc — cross-model document reviewer

`review-doc` sends a spec or plan you authored to a **different** model for an independent
critique, so the feedback isn't biased toward the style and blind spots of the model that wrote
it. It returns a **structured** review — per-criterion coverage, feasibility, line-anchored
findings, and a single machine-readable verdict — and persists each round as an immutable
artifact so you can iterate to approval and prove how you got there.

It is a **CLI tool + a workflow skill**, not an app: no server, no UI. The review logic lives in
a provider-agnostic core library; the CLI is the only transport.

> **Typical use:** a coding agent is the *author*. It drafts a spec, has `review-doc` critique it
> with a second model, addresses each finding, and re-runs until the spec is approved — then
> reviews the *plan* against that approved spec before any code is written.

---

## How it works

```
author model  ──writes──▶  spec.md / plan.md
                                │
                                ▼
        review-doc  ──sends doc + criteria──▶  reviewer model (must differ)
                                │
                                ▼
        { verdict, result }  +  immutable round artifact on disk
                                │
              ┌─────────────────┴─────────────────┐
        approved                            changes_requested
              │                                    │
              ▼                          respond to each finding,
        sign off / advance                  edit doc, re-run
```

- **Cross-model by default.** The reviewer model must differ from the author model (override with
  `--allow-same-model`). The author's identity is always recorded.
- **Criteria are explicit.** You pass a criteria file declaring `[CRIT-*]` items; the reviewer
  must report coverage for every one, exactly once.
- **Two stages.** `spec` reviews a document against criteria. `plan` *additionally* checks the
  plan covers every `[REQ-*]` requirement from an **approved** upstream spec.
- **Deterministic verdict.** The verdict is computed from the structured result by a pure
  function — the model reports findings/coverage; it does not get to declare "approved".

---

## Install

Requires **Node 20.6+**.

```bash
npm install
npm run build        # compiles TypeScript to dist/
npm test             # run the suite (no network; providers are mocked)
```

Run the built CLI directly:

```bash
node dist/cli/index.js <doc> --stage spec --criteria <criteria.md> ...
```

or link it as the `review-doc` command:

```bash
npm link
review-doc <doc> --stage spec --criteria <criteria.md> ...
```

---

## Credentials

The reviewer needs an API key. Set it in the environment, or put it in a `.env` file (handy for
local dev — see [`.env.example`](.env.example)):

```bash
# .env  (gitignored — never commit real keys)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_BASE_URL=https://your-openai-compatible-host/v1   # optional
```

- `review-doc` auto-loads `.env` from the current directory. Use `--dotenv <path>` to point at a
  different file (e.g. `--dotenv prod.env`).
- **A real exported shell variable always wins** over the `.env` file, so a stray `.env` can never
  override a live secret.
- The flag is `--dotenv`, **not** `--env-file` — Node 20.6+ has a built-in `--env-file` that would
  swallow the argument before `review-doc` sees it.

| Provider | Key | Notes |
|----------|-----|-------|
| `openai` | `OPENAI_API_KEY` | Any OpenAI-compatible endpoint with strict `json_schema`. Override the host with `OPENAI_BASE_URL` or `--reviewer-base-url`. |
| `anthropic` | `ANTHROPIC_API_KEY` | Forced tool-use for structured output. |

---

## The criteria file

A markdown list of criteria the reviewer judges the document against:

```markdown
# Spec review criteria

- [CRIT-SCOPE] The design stays within the stated v1 scope and defers non-blockers explicitly.
- [CRIT-FEASIBILITY] Every claimed guarantee is achievable by the described mechanism.
- [CRIT-CORRECTNESS] No described race, ambiguity, or contradiction can cause wrong behavior.
- [CRIT-STYLE OPTIONAL] Terminology is consistent across sections.
```

- `[CRIT-*]` ids are required-by-default; append ` OPTIONAL` to make one non-blocking.
- A ready-to-copy starter lives at [`examples/criteria.spec.md`](examples/criteria.spec.md).
- For the **plan** stage, the upstream **spec** carries `[REQ-*]` requirement tags (e.g.
  `- [REQ-AUTH] users can sign in`). Write them while authoring the spec — *before* it is approved
  — because the approval is bound to the spec's content hash.

### criteria init — scaffold project-specific criteria

Generate a **draft** criteria file from a spec, then review and edit it before use:

```bash
review-doc criteria init docs/my-spec.md \
  --generator-provider openai --generator-model gpt-5.4
# writes docs/my-spec.md.criteria.md  (use --out to change the path)
```

The draft contains a fixed, code-owned **baseline** block plus generated
`CRIT-PROJECT-*` criteria derived from the spec, and an advisory
**Suggested Requirements** section listing candidate `[REQ-*]` tags.

Important:

- The generated file is a **draft**. It is not trusted merely because
  review-doc produced it — review and edit it before passing it to
  `--criteria`.
- `criteria init` never runs a review and never modifies the spec.
- If the spec declares no `[REQ-*]` tags, it still succeeds (exit 0) with a
  warning; copy the suggested requirements into the spec yourself.
- Delete the Suggested Requirements section from the criteria file before
  using it with `--criteria`.
- `--reviewer-base-url <url>` overrides the base URL for an OpenAI-compatible endpoint (ignored for
  anthropic); `--dotenv <path>` points at an env file holding credentials (defaults to `.env`).

---

## Quick start — review a spec

```bash
review-doc spec.md \
  --stage spec \
  --criteria criteria.spec.md \
  --reviewer-provider openai   --reviewer-model gpt-5.4 \
  --author-provider  anthropic --author-model  claude-opus-4-8 \
  --new-lineage
```

Prints `{ verdict, result }` and writes a round artifact under `spec.md.review/<lineage>/round-1.json`.

**Exit codes:** `0` approved · `1` changes requested · `2` error.

The `result` object contains: `feasibility` (+ rationale), `criteriaCoverage` (one entry per
`[CRIT-*]`), `upstreamCoverage` (plan stage only), and line-anchored `findings` (each with
severity, a `fix`, and a `completionCondition`).

---

## The review loop

Iterate a document to approval:

1. **Review** the doc (command above). If `approved`, you're done.
2. **Respond** to each active finding. Write a JSON array, one entry per finding:

   ```json
   [
     { "findingId": "F1", "response": "accepted_and_revised" },
     { "findingId": "F2", "response": "rejected_with_evidence", "evidence": "§3 already covers this: ..." }
   ]
   ```

   Response kinds: `accepted_and_revised`, `rejected_with_evidence`, `already_addressed`,
   `needs_user_decision`. `rejected_with_evidence` and `already_addressed` require a non-empty
   `evidence` string. Then finalize them (write-once, pinned to the round):

   ```bash
   review-doc respond \
     --round spec.md.review/<lineage>/round-1.json \
     --responses responses.json
   ```

3. **Edit** the document to address accepted findings, then **re-run** the review as the next
   round in the same lineage:

   ```bash
   review-doc spec.md --stage spec --criteria criteria.spec.md \
     --reviewer-provider openai --reviewer-model gpt-5.4 \
     --author-provider anthropic --author-model claude-opus-4-8 \
     --prior-log spec.md.review/<lineage>/round-1.json
   ```

   The next round carries the prior findings and your responses forward, so the reviewer judges
   whether each was actually resolved.

4. If any response is `needs_user_decision`, **stop and bring in a human** before re-running.

The [`review-loop` skill](skills/review-loop/SKILL.md) packages this loop for an agent to drive.

---

## Advancing spec → plan

Once a spec is approved, review the plan against it. `review-doc` finds the spec's approved round,
**recompute-verifies** it (it re-runs validation and recomputes the verdict — it never trusts the
stored verdict), and binds the plan to the spec's content hash:

```bash
review-doc plan.md \
  --stage plan \
  --criteria criteria.plan.md \
  --prior spec.md \
  --reviewer-provider openai   --reviewer-model gpt-5.4 \
  --author-provider  anthropic --author-model  claude-opus-4-8 \
  --new-lineage
```

The plan is **blocked from approval** unless it covers every `[REQ-*]` from the spec (a `not_met`
requirement fails the verdict). If more than one approved spec lineage qualifies, pass
`--prior-approval <round.json>` to choose one.

---

## Compare mode

Send the same document to several reviewers at once (stateless; writes nothing). Useful for
picking a reviewer model or spot-checking agreement:

```bash
review-doc spec.md --stage spec --criteria criteria.spec.md \
  --author-provider anthropic --author-model claude-opus-4-8 \
  --compare openai:gpt-5.4,anthropic:claude-sonnet-4-6
```

Prints `{ entries, failures }`. Exit `0` if all reviewers succeeded, else `2`.

---

## CLI reference

| Flag | Meaning |
|------|---------|
| `<doc>` | Path to the document under review (positional). Or the `respond` subcommand. |
| `--stage spec\|plan` | Review stage. `plan` requires `--prior`. |
| `--criteria <file>` | Criteria file with `[CRIT-*]` declarations (required). |
| `--reviewer-provider <p>` `--reviewer-model <m>` | The reviewing model (`openai` or `anthropic`). |
| `--author-provider <p>` `--author-model <m>` | The authoring model's identity (recorded; must differ from the reviewer). |
| `--allow-same-model` | Permit reviewer == author (off by default). |
| `--reviewer-base-url <url>` | OpenAI-compatible host override (or set `OPENAI_BASE_URL`). |
| `--new-lineage` | Start a fresh review lineage (round 1). |
| `--prior-log <round.json>` | Continue a lineage from its latest round (carries findings + responses forward). |
| `--out <dir>` | Where to write round artifacts (default `<doc>.review`). |
| `--prior <spec.md>` | Plan stage: the approved upstream spec. |
| `--prior-approval <round.json>` | Plan stage: pick the spec's approved round when auto-selection is ambiguous. |
| `--compare <p:m,...>` | Compare mode: fan out to several reviewers (no persistence). |
| `--dotenv <path>` | Load credentials from a specific env file (default `.env` in CWD). |
| `respond --round <round.json> --responses <file>` | Finalize author responses to a round's findings (write-once). |

---

## What it is *not* (v1 scope & limitations)

The integrity checks are sized for a **cooperative** workflow — they catch corruption, staleness,
and accidental approval bypass from ordinary mistakes. They are **not** anti-forgery: there is no
signing, and anyone who can write the `.review` directory could craft a self-consistent "approved"
artifact. The approval gate is **advisory** — it records and verifies approval state but does not
physically prevent advancing. This is by design for a key-less local tool with a cooperating
author.

Deferred to a later version: an MCP transport, plugin packaging, more provider adapters
(GLM/Gemini via the OpenAI-compatible path), cryptographic signing / full recursive provenance,
and an enforcement hook.

---

## Development

```bash
npm test          # full suite, mocked providers, no network
npm run build     # tsc → dist/
```

Layout: `src/core` (provider-agnostic review logic, no `process`/filesystem), `src/cli` (the thin
transport + `.env` loading), `test/` (test-first throughout), `skills/review-loop` (the workflow
skill), `examples/` (starter criteria).
