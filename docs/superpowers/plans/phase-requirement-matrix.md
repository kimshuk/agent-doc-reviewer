# Phase ↔ Requirement Matrix

Authoritative coverage map from the approved spec's `[REQ-*]` manifest
(`docs/superpowers/specs/2026-06-22-review-doc-design.md`, v11) onto the execution phases.
The 21-task plan and spec are unmodified; this is a planning view only.

Legend: **complete** = fully satisfied in that phase · **partial** = partially satisfied,
finished in a later phase · **deferred** = not started yet · blank = not touched.

| `[REQ-*]` | Phase 1 | Phase 2 | Phase 3 | Notes |
|-----------|---------|---------|---------|-------|
| REQ-CORE | partial | **complete** | — | P1: stateless core lib + thin CLI (no `process` in core). P2: full persisting core/CLI. P3 only exercises plan-stage. |
| REQ-PROVIDER | partial | — | **complete** | P1: OpenAI-compatible reviewer via raw `fetch` + `--reviewer-base-url`. P3: Anthropic forced-tool adapter (Task 12), provider parity + reverse direction. |
| REQ-CONSTANT | **complete** | — | — | Full `REVIEW_SCHEMA` + constant prompts land in P1 and never change. |
| REQ-VALIDATE | partial | **complete** | — | P1: ajv structural + repair-once + semantic checks (coverage exact-set+linkage, finding-id uniqueness, `feasibilityFindingIds` 3-way, location bounds). P2: provenance, carry-forward completeness, lifecycle transitions, supersede linkage. |
| REQ-VERDICT | **complete** | — | (exercised) | Pure `computeVerdict` implemented in P1. Plan-stage `[REQ-*]` gating branch is exercised in P3 but the function is complete in P1. |
| REQ-IMMUTABLE | — | **complete** | — | Write-once round + finalize-once sidecar + `writeRoundOnce` fail-closed validation are P2. |
| REQ-LINEAGE | — | **complete** | — | Lineage selection/continuity, parent-pair re-verification — P2. |
| REQ-APPROVAL | — | — | **complete** | Recompute-verified, hash-bound, deterministic spec-approval selection — P3 (plan stage). |
| REQ-IDENTITY | **complete** | — | (extended) | Cross-model guard + always-required author identity in P1. P3 extends the guard to the Anthropic reviewer + each compare target already covered in P1. |
| REQ-COVERAGE | partial | — | **complete** | P1: `[CRIT-*]` exact-set + linkage. P3: `[REQ-*]` upstream coverage exact-set (plan stage). |
| REQ-COMPARE | **complete** | — | — | Stateless fresh-only compare with `{entries, failures}` stdout — P1 (drives the empirical eval). |
| REQ-SKILL | — | — | **complete** | `review-loop` SKILL.md + example criteria + full gate — P3. |
| REQ-TDD | complete (P1 scope) | complete (P2 scope) | complete (P3 scope) | Every task is test-first, every provider mocked, no real network — enforced each phase. (The Phase-1 *empirical* evaluation is a separate human-adjudicated gate, not a unit test.) |

## Invariants across phases

- No phase marks a REQ `complete` and then reopens it. `partial → complete` only moves forward.
- Phase 1 evidence is scoped to **Claude author → OpenAI-compatible reviewer** (Disposition A);
  REQ-PROVIDER stays `partial` until the Anthropic adapter ships in Phase 3.
- REQ-TDD is "complete for the phase's scope" — i.e. all code shipped in that phase is TDD;
  it is not a claim that later-phase code exists yet.
