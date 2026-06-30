# Phase 2 — Iteration & Immutable Artifacts (spec stage)

> A slice of the approved 21-task plan
> (`docs/superpowers/plans/2026-06-22-review-doc.md`). Starts **only** after Phase 1's
> empirical gate passes (`phase-1-review-quality-validation.md`). The 21-task plan and the
> approved spec are not changed.

## What we're testing, and why it helps the user

**The bet:** Phase 1 already proved the review is good. Phase 2 adds the paper trail. If we save
each review round so it **can't be changed after the fact**, save the author's **final answers**
to each finding, and **link the rounds together**, then the back-and-forth review loop becomes
reliable and the final "approved" record is trustworthy and tamper-evident. That's worth the extra
machinery.

**What the user gets:**
- Multi-round spec review with durable saved records.
- A clear `review-doc respond` step to lock in author answers.
- The ability to re-run a later round with `--prior-log`, which carries forward the earlier
  findings and answers and checks that the chain is intact.
- An approval state you can reproduce and re-verify.

## In scope

- **Hashing** — `sha256`, `sha256OfFile`.
- **The remaining semantic checks** (added to the Phase-1 `validateSemantic`):
  - **Provenance** — every finding marked `still_present` / `resolved` / `superseded` must point
    to an id that existed in `priorFindings`; a `new` id must not reuse a prior id.
  - **Carry-forward completeness** — every prior **active** finding must show up again exactly
    once, with an allowed next status: `still_present`, `resolved`, or `superseded`. Note:
    `still_present` is **not** an ending state — only `resolved` and `superseded` end a finding.
  - **Supersede linkage** — a superseded finding must point at a real replacement.
  - **Mode split** — these run only in `full` mode, not `within_result`.
- **Write-once round records** plus:
  - `writeRoundOnce`, which refuses to write if the record is malformed or its round/lineageId
    don't match where it's being saved (fail-closed).
  - The record/answer schemas (`ROUND_ARTIFACT_SCHEMA`, `RESPONSES_ARTIFACT_SCHEMA`) that were
    deferred from Phase-1 Task 2.
- **Author responses** — `validateResponses`, a finalize-once sidecar file (write to a unique
  `crypto.randomUUID` temp name, then `linkSync` so an existing file is never overwritten), and
  `readResponses` that re-checks the saved file.
- **Lineage selection & continuity** — pick the lineage from `--prior-log` (must be its latest
  round), check stage/criteria/prior match, re-bind the sidecar, re-verify the **immediate
  parent pair** against the `round-(N-1)` files on disk, plus `--new-lineage` and bootstrap.
- **A new `reviewDocument` export** that **calls** Phase-1's frozen `reviewOnce` and adds the
  saving layer on top: it writes the immutable `round-N.json` and returns `roundPath`. It finds
  priors from the lineage and passes them through `reviewOnce`'s **existing** `ReviewOnceInput`
  fields (`priorFindings`, `priorResponses`) — **`reviewOnce`'s signature does not change**.
  `validateSemantic` (same signature) is what gains the new lifecycle behavior when
  `priorFindings` is non-empty.
- **CLI additions** — `respond` (`--responses <file>`; rejects `--out` and stdin `-`),
  `--prior-log`, `--new-lineage`, `--out`.

## Out of scope (saved for Phase 3)

Plan-stage review, `[REQ-*]` upstream coverage, approval-artifact verification,
`--prior` / `--prior-approval`, the Anthropic adapter, and the `review-loop` skill.

## Tasks pulled from the 21-task plan (with what changes for Phase 2)

| Task | Pull | Change for Phase 2 |
|------|------|-------------------|
| 2 (remainder) | partial | Add `ROUND_ARTIFACT_SCHEMA` + `RESPONSES_ARTIFACT_SCHEMA` + `validateRoundArtifact`/`validateResponsesArtifact` (deferred from Phase 1), including the parent-hash `if/then/else` invariant and the non-empty-identity `minLength`. |
| 3 Hashing | full | none |
| 8 (remainder) | partial | Add provenance, carry-forward completeness, lifecycle transitions, and supersede linkage to the **same** `validateSemantic`/`SemanticContext` from Phase 1. Phase-1 checks #1–#4 stay as-is. |
| 14 Persistence | full | Write-once + `writeRoundOnce` fail-closed validation + `readRound` envelope validation. |
| 15 Author responses | full | `validateResponses` + finalize-once sidecar + `readResponses`. |
| 16 Lineage selection & continuity | full | latest-round/continuity + sidecar re-bind + immediate parent-pair re-verification + bootstrap. |
| 19 (remainder) | partial | Add a **new** `reviewDocument` that calls the frozen `reviewOnce` (Phase 1) and adds `selectLineage` + `writeRoundOnce`; returns `{verdict, result, roundPath}`. Do **not** edit `reviewOnce`. (Plan-stage `verifyApproval` stays out — Phase 3.) |
| 20 (remainder) | partial | Add the `respond` subcommand + `--prior-log`, `--new-lineage`, `--out`. (`--prior`/`--prior-approval` stay out — Phase 3.) |

## Frozen `reviewDocument` contract (set here, never edited)

Like `reviewOnce`, `reviewDocument`'s **input type is fixed now, with Phase 3's plan-stage fields
already present but reserved** — so Phase 3 can fill them in without changing the signature:

```ts
export interface ReviewDocumentInput {
  docPath: string;
  stage: Stage;                                   // Phase 2 supports "spec" only (see below)
  criteriaPath: string;
  reviewer: { provider: ReviewerProvider; model: string };
  reviewerIdentity: Identity;
  author: Identity;
  allowSameModel: boolean;
  priorLogPath?: string;                          // lineage continuation (Phase 2)
  newLineage: boolean;
  outDir?: string;
  // ── reserved for Phase 3 (plan stage); UNSUPPORTED in Phase 2 ──
  priorPath?: string;                             // approved upstream spec
  priorApprovalPath?: string;                     // its approval artifact
  now: () => string;
  mintLineageId: () => string;
}

export function reviewDocument(input: ReviewDocumentInput): Promise<{ verdict: Verdict; result: ReviewResult; roundPath: string }>;
```

- **Phase 2 supports `stage:"spec"` only.** If `stage === "plan"`, or `priorPath` /
  `priorApprovalPath` is given, Phase 2 throws a `UsageError` ("plan stage is not supported until
  Phase 3") — it's rejected on purpose, not quietly ignored. Phase 3 turns these on by adding the
  plan branch (`verifyApproval` + `requirementIds` + passing `prior` through to `reviewOnce`),
  with **no change to this signature**.
- `reviewDocument` finds priors from the lineage (`selectLineage`) and calls the frozen
  `reviewOnce`, passing `priorFindings`/`priorResponses` (and, in Phase 3, `prior`).

## Before starting

- **Phase 1 is done** (empirical gate passed; stateless reviewer + full schema + Phase-1 semantic
  checks shipped).
- Phase-1 pieces are available: `ReviewResult`/`REVIEW_SCHEMA`/`validateStructural`,
  `validateSemantic` + `SemanticContext`, `runReview`, `computeVerdict`, the stateless
  `reviewOnce`, and provider/registry/identity.

## What Phase 3 inherits from this work

- `RoundArtifact` + `writeRoundOnce`/`readRound`/`listRounds`; `validateRoundArtifact`.
- `finalizeResponses`/`validateResponses`/`readResponses`/`sidecarPathFor`.
- `selectLineage` + `LineageSelection`.
- The saving `reviewDocument({...}) → {verdict, result, roundPath}` and the approved **spec round
  record** that Phase 3's plan stage uses as its `--prior` approval.

## Test plan (automated, no network)

- Every pulled task's tests, per the 21-task plan (test-first, mocked providers, no network):
  schema validation, the parent-hash invariant, write-once collision, finalize-once + no-clobber,
  sidecar re-bind, parent-pair re-verification, and `respond` rejecting `--out`/stdin.
- **Reserved-field guard:** `reviewDocument` with `stage:"plan"` (or a `priorPath`/
  `priorApprovalPath`) throws `UsageError` ("plan stage not supported until Phase 3") — proving
  the reserved fields are rejected, not silently ignored.
- `npm run build` exits 0.
- **End-to-end (mocked provider):** spec review (round 1) → `respond` finalize → re-run with
  `--prior-log` (round 2 carries the prior findings/answers and checks continuity) → an
  `approved` round closes the lineage.

## Manual check by a human

Phase 2 has **no new review-quality gate** (quality was settled in Phase 1). This check is about
**operations**: on 1–2 real specs, run a real multi-round loop against the Phase-1-validated
reviewer and confirm that (a) the records are immutable and hash-consistent, (b) a tampered
sidecar/parent is rejected, and (c) the lineage reaches `approved` exactly when the verdict rule
says it should.

## Done when

- All Phase-2 task tests pass; `tsc` builds clean.
- An end-to-end spec-stage loop (review → respond → re-run → approved) works on a real spec, with
  durable records that can be re-verified.

## If it goes wrong

- If the saving/lineage model turns out to be the wrong shape in practice (e.g. the record can't
  represent a state we need), **stop and raise `needs_user_decision`** instead of improvising a
  schema change — the round record is the integrity root.
- **Rollback:** Phase 1's stateless reviewer still works fully; turning off the saving path goes
  back to one-shot reviews with no data to migrate. Do **not** delete or rewrite existing records
  on rollback (they are immutable by contract).

## Deferred (spelled out)

Plan-stage review · `[REQ-*]` upstream coverage · approval-artifact verification ·
`--prior`/`--prior-approval` · Anthropic adapter · `review-loop` skill (→ Phase 3).
