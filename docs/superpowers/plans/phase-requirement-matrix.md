# Phase ↔ Requirement Matrix

Authoritative coverage map from the approved spec's `[REQ-*]` manifest
(`docs/superpowers/specs/2026-06-22-review-doc-design.md`, v11) onto the execution phases.
The 21-task plan and spec are unmodified; this is a planning view only.

Legend: **complete** = fully satisfied in that phase · **partial** = partially satisfied,
finished in a later phase · **deferred** = not started yet · blank = not touched.

Two distinct columns, so the gate is not "pre-passed" before any code exists:

- **Target (end of v1)** — the *planned* cumulative status. These are all `complete` **by
  design**; they describe intent, not achievement.
- **Verified** — the *actual* status, backed by evidence. Starts `⬜ pending` for every row and
  is flipped to `✅ verified` **only** when that REQ's tests pass (and, for REQ involving review
  quality, the Phase-1 empirical gate passes), with a link to the test file / eval run.

**Phase 3's "all REQ complete" gate is satisfied iff every row's _Verified_ column reads
`✅ verified` with evidence** — never merely because _Target_ says `complete`.

Evidence links are repo-relative test paths; the whole suite is green at **152/152** with
`tsc` exit 0 (commit `781b377`, branch `phase-3-plan-stage-and-skill`). Run with `npm test`.

| `[REQ-*]` | Phase 1 | Phase 2 | Phase 3 | Target (end of v1) | Verified | Notes |
|-----------|---------|---------|---------|--------------------|----------|-------|
| REQ-CORE | partial | **complete** | — | complete | ✅ verified — `test/core/orchestrator.test.ts`, `test/cli/cli.test.ts` | P1: stateless core lib + thin CLI (no `process` in core). P2: full persisting core/CLI. P3 only exercises plan-stage. |
| REQ-PROVIDER | partial | — | **complete** | complete | ✅ verified — `test/core/anthropic.test.ts`, `test/core/openai.test.ts`, `test/core/registry.test.ts` | P1: OpenAI-compatible reviewer via raw `fetch` + `--reviewer-base-url`. P3: Anthropic forced-tool adapter (Task 12), provider parity + reverse direction. |
| REQ-CONSTANT | **complete** | — | — | complete | ✅ verified — `test/core/prompt.test.ts`, `test/core/schema.test.ts` | Full `REVIEW_SCHEMA` + constant prompts land in P1 and never change. |
| REQ-VALIDATE | partial | **complete** | — | complete | ✅ verified — `test/core/schema.test.ts`, `test/core/semantics.coverage.test.ts`, `test/core/semantics.lifecycle.test.ts`, `test/core/review.test.ts` | P1: ajv structural + repair-once + semantic checks (coverage exact-set+linkage, finding-id uniqueness, `feasibilityFindingIds` 3-way, location bounds) **+ the `full`-mode empty-priors invariant** (`status:"new"`, empty `supersededByFindingIds`). P2: provenance, carry-forward completeness, lifecycle transitions, supersede linkage. |
| REQ-VERDICT | **complete** | — | (exercised) | complete | ✅ verified — `test/core/verdict.test.ts`; plan `[REQ-*]` gating `test/core/orchestrator.test.ts` | Pure `computeVerdict` implemented in P1. Plan-stage `[REQ-*]` gating branch is exercised in P3 but the function is complete in P1. |
| REQ-IMMUTABLE | — | **complete** | — | complete | ✅ verified — `test/core/persistence.test.ts`, `test/core/responses.test.ts` | Write-once round + finalize-once sidecar + `writeRoundOnce` fail-closed validation are P2. |
| REQ-LINEAGE | — | **complete** | — | complete | ✅ verified — `test/core/lineage.test.ts` | Lineage selection/continuity, parent-pair re-verification — P2. |
| REQ-APPROVAL | — | — | **complete** | complete | ✅ verified — `test/core/approval.test.ts` (incl. tamper + explicit-path + ambiguity); plan binding `test/core/orchestrator.test.ts` | Recompute-verified, hash-bound, deterministic spec-approval selection — P3 (plan stage). |
| REQ-IDENTITY | **complete** | — | (extended) | complete | ✅ verified — `test/core/identity.test.ts`, `test/core/registry.test.ts` | Cross-model guard + always-required author identity in P1. P3 extends the guard to the Anthropic reviewer + each compare target already covered in P1. |
| REQ-COVERAGE | partial | — | **complete** | complete | ✅ verified — `test/core/criteria.test.ts`, `test/core/semantics.coverage.test.ts`, `test/core/orchestrator.test.ts` | P1: `[CRIT-*]` exact-set + linkage. P3: `[REQ-*]` upstream coverage exact-set (plan stage). |
| REQ-COMPARE | **complete** | — | — | complete | ✅ verified — `test/core/compare.test.ts`, `test/cli/cli.test.ts` | Stateless fresh-only compare with `{entries, failures}` stdout — P1 (drives the empirical eval). |
| REQ-SKILL | — | — | **complete** | complete | ✅ verified — `test/skill/skill.test.ts` | `review-loop` SKILL.md + example criteria + full gate — P3. |
| REQ-TDD | complete (P1 scope) | complete (P2 scope) | complete (P3 scope) | complete | ✅ verified — whole suite `npm test` (152/152) | Every task is test-first, every provider mocked, no real network — enforced each phase. (The Phase-1 *empirical* evaluation is a separate human-adjudicated gate, not a unit test.) |

Every _Verified_ cell now reads `✅ verified` against **automated** evidence (passing tests, no
network). The matrix asserts the *target* and tracks the *evidence* separately; these links are
the evidence.

### Outstanding (human-run, NOT covered by the ✅ above)

Two gates require real API keys + human adjudication and are **not** satisfied by the automated
suite. They are unchanged from the Phase-1/2 deferral:

- **Phase-1 empirical review-quality eval** — does the reviewer produce *good* reviews on real
  documents (the value claim behind the tool)? Scoped to Disposition A (Claude author →
  OpenAI-compatible reviewer); the Anthropic-as-reviewer direction added in P3 would need its own
  run. Per-row ✅ above is code-behavior evidence only, never a quality claim.
- **Phase-3 end-to-end real-document walkthrough** (plan §"Manual evaluation procedure"):
  author a spec → approve via the Phase-2 loop → plan-review with `--prior` confirming `[REQ-*]`
  enforcement + a `not_met`/missing requirement blocks approval → exercise the `review-loop` skill.

These need a human with credentials; a background agent with mocked providers cannot run them.

## Invariants across phases

- No phase marks a REQ `complete` and then reopens it. `partial → complete` only moves forward.
- Phase 1 evidence is scoped to **Claude author → OpenAI-compatible reviewer** (Disposition A);
  REQ-PROVIDER stays `partial` until the Anthropic adapter ships in Phase 3.
- REQ-TDD is "complete for the phase's scope" — i.e. all code shipped in that phase is TDD;
  it is not a claim that later-phase code exists yet.
