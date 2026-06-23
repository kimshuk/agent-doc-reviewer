# review-doc Implementation Master Plan (phased)

> **Status:** phased execution wrapper over the approved, frozen v1 plan
> `docs/superpowers/plans/2026-06-22-review-doc.md` (the "21-task plan") and the
> approved spec `docs/superpowers/specs/2026-06-22-review-doc-design.md` (v11).
> The 21-task plan and the spec are **preserved unmodified**. This master plan and the
> phase plans are **execution slices**: they decide *order, scope, and acceptance per
> slice*. They do **not** replace the product-spec approval artifact, and they do not
> change any task's code.

**Goal:** Ship the approved `review-doc` v1 in validated increments, gating the build on
*empirical review quality* before investing in persistence/lineage/approval machinery.

**Why phased:** The approved plan is sound on paper, but its value rests on one unproven
empirical claim — that a different model, given the constant rubric + strict schema,
produces *useful, actionable* findings. Phase 1 tests that claim on real specs before we
build the durable-artifact and approval machinery on top of it.

## Phase sequence

| Phase | Doc | Theme | Gate to advance |
|-------|-----|-------|-----------------|
| 1 | `phase-1-review-quality-validation.md` | Stateless spec review + **empirical quality validation** | All Phase-1 tests + build green **and** the approved empirical threshold met by ≥1 reviewer config |
| 2 | `phase-2-iteration-and-artifacts.md` | Immutable rounds, finalized responses, lineage continuity (spec stage) | All Phase-2 tests + build green; end-to-end spec review→respond→re-run→approved lineage works |
| 3 | `phase-3-plan-stage-and-skill.md` | Plan-stage upstream review + approval gating + Anthropic adapter + `review-loop` skill | Full v1 per approved spec; all 21 tasks complete; REQ matrix all `complete` |

Each phase produces working, testable software on its own. A later phase never edits a
prior phase's shipped contract — it extends it through the interfaces named in each phase doc.

## Companion documents

- `phase-requirement-matrix.md` — every approved `[REQ-*]` × phase, marked
  `partial`/`complete`/`deferred`. This is the authoritative coverage map.
- `spec-amendment-reviewer-base-url.md` — the **minimal proposed amendment** adding the
  `--reviewer-base-url` CLI option (Disposition A). The approved spec is **not** edited
  until that amendment is itself approved.

## Requirement coverage (all approved `[REQ-*]`, exactly)

The approved spec defines 13 binding requirements. The master plan covers **all** of them;
the per-phase split is in `phase-requirement-matrix.md`. Summary:

- **Phase 1 completes:** REQ-CONSTANT, REQ-VERDICT, REQ-IDENTITY, REQ-COMPARE.
- **Phase 1 partial:** REQ-CORE (stateless core + thin CLI), REQ-PROVIDER (OpenAI-compatible
  reviewer + `--reviewer-base-url`; Anthropic deferred), REQ-VALIDATE (structural + 4 of the
  semantic checks + repair-once), REQ-COVERAGE (`[CRIT-*]` exact-set), REQ-TDD (Phase-1 scope).
- **Phase 2 completes:** REQ-CORE, REQ-VALIDATE, REQ-IMMUTABLE, REQ-LINEAGE.
- **Phase 3 completes:** REQ-PROVIDER (Anthropic), REQ-APPROVAL, REQ-COVERAGE (`[REQ-*]`
  upstream), REQ-SKILL. REQ-TDD remains `complete` per-phase throughout.

## Cross-model scope of the Phase-1 evidence (Disposition A)

Phase 1 validates **only** the primary direction: **Claude author → OpenAI-compatible
reviewer**, with reviewer swappability via `--reviewer-base-url`/`--reviewer-model`. Phase-1
empirical results **must not** be generalized to Anthropic-as-reviewer or to arbitrary
cross-model pairings. The full Anthropic adapter contract is retained in the 21-task plan
(Task 12) and implemented in Phase 3 for provider parity and the reverse direction.

## Custom-endpoint boundary (Disposition A)

Custom reviewer endpoints are supported **only** when OpenAI-compatible at
`/chat/completions` **and** honoring strict `response_format: {type:"json_schema", ...}`.
`repair-once` is a **schema/semantic** repair; it does **not** assume it can recover an HTTP
error caused by an unsupported `response_format`. A looser JSON mode or any per-endpoint
fallback is **out of scope** — if one becomes necessary, stop and raise `needs_user_decision`;
do not add it unilaterally.

## What this wrapper does NOT do

- It does not modify the 21-task plan or the approved spec.
- It does not re-derive task code — each phase doc references the approved tasks by number and
  states only the **scope delta** (what is pulled, cut, or deferred) for that slice.
- It does not introduce new product requirements. Any new decision halts at
  `needs_user_decision`.
