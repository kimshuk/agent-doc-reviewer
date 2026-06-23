# Proposed Spec Amendment — `--reviewer-base-url` (reviewer swappability)

> **Status:** PROPOSED. Not yet merged into the approved spec. The approved spec
> `docs/superpowers/specs/2026-06-22-review-doc-design.md` (v11) is **not** edited until this
> amendment is reviewed and approved. This document exists because Disposition A introduces a
> CLI option that is **not** in the approved spec, and "기존 승인 spec을 조용히 수정하지
> 않는다" — the approved spec must not be silently changed.

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

Until approved, Phase 1 implements the flag as specified here and treats this document as the
authority; the approved spec text is untouched.
