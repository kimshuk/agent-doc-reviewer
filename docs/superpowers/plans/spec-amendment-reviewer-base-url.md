# Proposed Spec Amendment — `--reviewer-base-url` (reviewer swappability)

> **Status:** ✅ APPROVED & INCORPORATED into spec **v12**
> (`docs/superpowers/specs/2026-06-22-review-doc-design.md`). All "Required spec edits if
> approved" below have been applied (§3 CLI surface, §3 Keys & env, §5 adapters, §9 backlog,
> status → v12). Phase 1 is now unblocked. This document is retained as the amendment record.
> (Originally PROPOSED against v11 — the approved spec was not silently changed; per Disposition A
> this CLI option was reviewed and approved before merging.)

## Motivation

Phase 1 needs **reviewer swappability** to (a) run the primary cross-model workflow
(Claude author → a non-Claude OpenAI-compatible reviewer) and (b) compare multiple reviewer
models/endpoints during the empirical evaluation — without adding a second request protocol.

The approved core already supports a base URL: `createOpenAIProvider({ apiKey, baseURL })`
posts to `${baseURL ?? "https://api.openai.com/v1"}/chat/completions`, and the registry reads
`env.OPENAI_BASE_URL` (21-task plan, Tasks 10–11). The only gap is a **CLI surface** to set it
per-invocation. This amendment adds exactly that.

## Proposed change (minimal)

Add one CLI option to §3 of the spec:

```
  --reviewer-base-url <url>   OpenAI-compatible base URL for the reviewer
                              (default: https://api.openai.com/v1; env OPENAI_BASE_URL)
```

Semantics:

- `--reviewer-base-url` sets the `baseURL` passed to the OpenAI-compatible reviewer adapter.
  Precedence: `--reviewer-base-url` > `env.OPENAI_BASE_URL` > built-in default.
- It applies to the **reviewer** only. There is no author HTTP call (the author is the local
  coding agent), so no author base URL exists.
- With `--compare`, each comparison entry uses the same `--reviewer-base-url` unless a future
  amendment adds per-entry endpoints (not proposed here).

## Scope limits (Disposition A — binding)

1. **Protocol:** custom endpoints are supported **only** if OpenAI-compatible at
   `/chat/completions` **and** they honor strict
   `response_format: {type:"json_schema", json_schema:{name, strict:true, schema}}`.
2. **repair-once:** the single repair retry is a **schema/semantic** repair (it re-sends the
   prior invalid output + combined validation errors). It is **not** assumed to recover an
   **HTTP error** raised by an endpoint that does not support the requested `response_format`.
   Such an HTTP failure surfaces as a normal provider error (exit 2), not a repairable state.
3. **No looser modes, no fallback:** a looser JSON mode (e.g. `response_format: json_object`),
   prompt-only JSON coercion, or any per-endpoint fallback is **out of scope**. If an endpoint
   you need cannot meet (1), **stop and raise `needs_user_decision`** — do not add a fallback
   unilaterally.

## Compatibility

- Backward compatible: omitting the flag preserves current behavior (default OpenAI base URL
  or `OPENAI_BASE_URL`).
- The constant control variables (schema, rubric, prompts, temperature 0) are unchanged — only
  the reviewer endpoint URL varies, which is consistent with the spec's "provider is the only
  variable under test" framing.

## Required spec edits if approved

- §3 CLI surface: add the `--reviewer-base-url` line above.
- §3 Keys & env: note `OPENAI_BASE_URL` as the env form.
- §5 (adapters): one sentence that the OpenAI-compatible adapter's `baseURL` is CLI-settable
  and constrained to strict `json_schema` endpoints (scope limit 1).
- §9 backlog: add "looser JSON mode / per-endpoint reviewer fallback" as deferred.
- Bump spec status (e.g. v12) and re-approve.

## Sequencing (binding)

**Phase 1 cannot begin until this amendment is approved and incorporated into a newly approved
spec version (v12).** The order is strict:

1. Review this amendment.
2. Incorporate the edits above into the spec and re-approve as **v12**.
3. **Then** execute Phase 1 against the v12 spec.

`--reviewer-base-url` must **not** be implemented ahead of that approval. The approved spec text
is not edited until step 2.
