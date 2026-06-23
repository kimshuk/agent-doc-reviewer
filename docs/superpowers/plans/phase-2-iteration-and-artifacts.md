# Phase 2 — Iteration & Immutable Artifacts (spec stage)

> Execution slice over the approved 21-task plan
> `docs/superpowers/plans/2026-06-22-review-doc.md`. Begins **only** after Phase 1's empirical
> gate has passed (`phase-1-review-quality-validation.md`). The 21-task plan and approved spec
> are unmodified.

## Hypothesis & user value

**Hypothesis:** once review quality is proven (Phase 1), persisting **immutable** rounds +
**finalized** author responses + **lineage continuity** makes the iterative review loop reliable
and produces a trustworthy, tamper-evident approval record — worth the integrity machinery.

**User value:** multi-round spec review with durable artifacts; a disciplined
`review-doc respond` finalize flow; re-running a later round via `--prior-log` that carries prior
findings + responses and verifies continuity. The approval state becomes reproducible.

## In scope

- Hashing (`sha256`, `sha256OfFile`).
- The **remaining** semantic checks: provenance (`still_present`/`resolved`/`superseded` ids ∈
  `priorFindings`; `new` ids don't collide), carry-forward completeness (every prior **active**
  finding reappears exactly once, with an **allowed next status: `still_present` | `resolved` |
  `superseded`** — note `still_present` is *not* terminal; only `resolved`/`superseded` are
  terminal), supersede linkage, and the `mode`-gated split (`within_result` vs `full`).
- Write-once round artifacts + the `writeRoundOnce` fail-closed validation (schema +
  round/lineageId match) + envelope schemas (`ROUND_ARTIFACT_SCHEMA`,
  `RESPONSES_ARTIFACT_SCHEMA`) deferred from Phase-1 Task 2.
- Author responses: `validateResponses` + finalize-once sidecar (`crypto.randomUUID` temp +
  no-clobber `linkSync`), `readResponses` envelope validation.
- Lineage selection & continuity: `--prior-log` latest-round + stage/criteria/prior checks,
  sidecar re-bind, **immediate parent-pair** re-verification against on-disk `round-(N-1)` files,
  `--new-lineage`, bootstrap.
- A **new** `reviewDocument` export that **calls** Phase-1's frozen `reviewOnce` and layers the
  persisting path on top (writes the immutable `round-N.json`, returns `roundPath`). It resolves
  priors from the lineage and passes them through the **already-defined** `ReviewOnceInput` fields
  (`priorFindings`, `priorResponses`) — **no change to `reviewOnce`'s signature**. `reviewOnce` is
  not modified; `validateSemantic` (same signature) is what gains the lifecycle behavior when
  `priorFindings` is non-empty.
- CLI remainder: `respond` (`--responses <file>`, rejects `--out` and stdin `-`), `--prior-log`,
  `--new-lineage`, `--out`.

## Out of scope (deferred)

- Plan-stage upstream review, `[REQ-*]` upstream coverage, approval-artifact verification,
  `--prior`/`--prior-approval`, Anthropic adapter, `review-loop` skill → **Phase 3**.

## Tasks pulled from the 21-task plan (with scope delta)

| Task | Pull | Delta for Phase 2 |
|------|------|-------------------|
| 2 (remainder) | partial | Add `ROUND_ARTIFACT_SCHEMA` + `RESPONSES_ARTIFACT_SCHEMA` + `validateRoundArtifact`/`validateResponsesArtifact` (deferred from Phase 1), including the parent-hash `if/then/else` invariant and non-empty-identity `minLength`. |
| 3 Hashing | full | none |
| 8 (remainder) | partial | Add provenance, carry-forward completeness, lifecycle transitions, supersede linkage to the **same** `validateSemantic`/`SemanticContext` shipped in Phase 1. Phase-1 checks #1–#4 stay as-is. |
| 14 Persistence | full | Write-once + `writeRoundOnce` fail-closed validation + `readRound` envelope validation. |
| 15 Author responses | full | `validateResponses` + finalize-once sidecar + `readResponses`. |
| 16 Lineage selection & continuity | full | latest-round/continuity + sidecar re-bind + immediate parent-pair re-verification + bootstrap. |
| 19 (remainder) | partial | Add a **new** `reviewDocument` that calls the frozen `reviewOnce` (Phase 1) and adds `selectLineage` + `writeRoundOnce`; returns `{verdict, result, roundPath}`. Do **not** edit `reviewOnce`. (Plan-stage `verifyApproval` stays out — Phase 3.) |
| 20 (remainder) | partial | Add `respond` subcommand + `--prior-log`, `--new-lineage`, `--out`. (`--prior`/`--prior-approval` stay out — Phase 3.) |

## Preconditions

- **Phase 1 complete** (empirical gate passed; stateless reviewer + full schema + Phase-1
  semantic checks shipped).
- Phase-1 interfaces available: `ReviewResult`/`REVIEW_SCHEMA`/`validateStructural`,
  `validateSemantic`+`SemanticContext`, `runReview`, `computeVerdict`, stateless `reviewOnce`,
  provider/registry/identity.

## Interface handed to Phase 3

- `RoundArtifact` + `writeRoundOnce`/`readRound`/`listRounds`; `validateRoundArtifact`.
- `finalizeResponses`/`validateResponses`/`readResponses`/`sidecarPathFor`.
- `selectLineage` + `LineageSelection`.
- Persisting `reviewDocument({...}) → {verdict, result, roundPath}` and the approved **spec
  round artifact** that Phase 3's plan stage consumes as `--prior` approval.

## Test procedure (automated, no network)

- All pulled tasks' tests per the 21-task plan (test-first, mocked providers, no network):
  envelope validation, parent-hash invariant, write-once collision, finalize-once + no-clobber,
  sidecar re-bind, parent-pair re-verification, `respond` rejects `--out`/stdin.
- `npm run build` exits 0.
- End-to-end (mocked provider): spec review (round 1) → `respond` finalize → re-run with
  `--prior-log` (round 2 carries prior findings/responses, verifies continuity) → an `approved`
  round closes the lineage.

## Manual evaluation procedure

Phase 2 has **no new empirical-quality gate** (review quality was settled in Phase 1). The
manual check here is **operational**: on 1–2 real specs, drive an actual multi-round loop
against the Phase-1-validated reviewer and confirm (a) artifacts are immutable and
hash-consistent, (b) a mutated sidecar/parent is rejected, (c) the lineage reaches `approved`
exactly when the verdict rule says so.

## Completion conditions

- All Phase-2 task tests pass; `tsc` builds clean.
- An end-to-end spec-stage loop (review → respond → re-run → approved) works on a real spec with
  durable, re-verifiable artifacts.

## Abort / experiment-failure decision

- If the persistence/lineage model proves wrong-shaped in practice (e.g. the artifact contract
  can't represent a needed state), **stop and raise `needs_user_decision`** rather than
  improvising a schema change — the round artifact is the integrity root.
- **Rollback:** Phase 1's stateless reviewer remains fully usable; disabling the persisting path
  reverts to one-shot reviews with no data to migrate. Do not delete or rewrite existing
  artifacts on rollback (they are immutable by contract).

## Deferred items (explicit)

Plan-stage review · `[REQ-*]` upstream coverage · approval-artifact verification ·
`--prior`/`--prior-approval` · Anthropic adapter · `review-loop` skill (→ Phase 3).
