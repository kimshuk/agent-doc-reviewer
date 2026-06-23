# Phase 1 — Review-Quality Validation (stateless spec review)

> Execution slice over the approved 21-task plan
> `docs/superpowers/plans/2026-06-22-review-doc.md`. Pulls a subset of tasks, states the
> scope delta for each, and adds an empirical-evaluation gate. The 21-task plan and the
> approved spec are unmodified. See `implementation-master-plan.md` for the wrapper context
> and `phase-requirement-matrix.md` for REQ coverage.

## Hypothesis & user value

**Hypothesis (the thing this phase exists to test):** a *different* model, given the constant
rubric + strict JSON schema, produces findings on real specs that a human adjudicates as
**mostly valid and actionable**, with **few serious false-positives**, and **catches seeded
defects** — strongly enough to justify building the persistence / lineage / approval machinery
on top of it.

**Scope of the claim (Disposition A):** evidence is for the **Claude author → OpenAI-compatible
reviewer** direction only. It must **not** be generalized to Anthropic-as-reviewer or to
arbitrary cross-model pairings.

**User value, immediately:** a working one-shot reviewer —
`review-doc <spec.md> --stage spec --criteria <file> --reviewer-base-url <url> --reviewer-model <m>`
— returns `{verdict, result}` JSON usable for ad-hoc spec review *before* any persistence
exists. `--compare` runs several reviewer **models** side by side **against a single
`--reviewer-base-url`**; comparing different *endpoints* is done with separate invocations
(see "Manual evaluation procedure").

## In scope

- **Full** `ReviewResult` type + `REVIEW_SCHEMA` (Disposition B): all fields, including
  `status`, `supersededByFindingIds`, `upstreamCoverage`. The Phase-1 reviewer **emits**
  `status:"new"` for every finding and `upstreamCoverage: []` (spec stage). No field is removed.
- Structural validation (ajv) + **repair-once** (schema/semantic repair only; not an HTTP-error
  recovery — Disposition A).
- Phase-1 **semantic validation, exactly these four** (Disposition C):
  1. criteria coverage **exact-set + linkage** (vs `[CRIT-*]`),
  2. finding-id **uniqueness**,
  3. `feasibilityFindingIds` **3-way** consistency,
  4. **location bounds** (`where.startLine`/`endLine` within the rendered doc).
- **Stateless invariant (closes an approval leak — see below).** Because lifecycle validation is
  deferred to Phase 2 but the schema still *allows* `resolved`/`superseded`, enforce: **when there
  are no prior findings (`priorFindings` empty — always true in Phase 1), every finding must have
  `status: "new"` and `supersededByFindingIds: []`**. A violation is a **semantic validation
  failure** (triggers the one repair retry, then exit 2). This guarantees no non-`new`
  (already-"resolved") required finding can silently slip through `computeVerdict`'s
  active-finding test. Gating on *empty `priorFindings`* (rather than a Phase-1-only flag) makes
  it a **sound universal rule**: it also holds for Phase 2 round-1 / `--new-lineage` reviews, and
  is inert once a prior round legitimately produces non-`new` statuses. It is **not** one of the
  four lifecycle checks deferred by Disposition C.
- Pure `computeVerdict` (spec-stage path: `approved` iff feasibility ≠ `not_feasible` and no
  active required finding and no `not_met` required criterion; `upstreamCoverage` empty).
- Constant prompt builders; line-numbered rendering; `[CRIT-*]` parsing.
- OpenAI-compatible reviewer adapter (raw `fetch`, strict `response_format.json_schema`,
  `temperature: 0`) + provider registry + cross-model identity guard + **`--reviewer-base-url`**
  (per `spec-amendment-reviewer-base-url.md`).
- **Stateless** `reviewOnce` (read → prompt → `runReview` → `{verdict, result}`; no
  persistence/lineage/approval). Named `reviewOnce` — distinct from Phase 2's persisting
  `reviewDocument` — so no later phase mutates a Phase-1 contract (see "Interface").
- Stateless **compare** mode (`{entries, failures}` to stdout) — drives the empirical eval.
- Thin CLI: `review` + `compare` subset only.
- **Empirical evaluation** (the gate; see "Manual evaluation procedure").

## Out of scope (deferred — see the named phase)

- Hashing, write-once round artifacts, finalize-once response sidecar, lineage continuity,
  `respond` subcommand, `--prior-log`/`--new-lineage`/`--out` → **Phase 2**.
- Semantic provenance, carry-forward completeness, lifecycle transitions, supersede linkage →
  **Phase 2**.
- Plan-stage upstream review, `[REQ-*]` upstream coverage, approval-artifact verification,
  `--prior`/`--prior-approval`, `review-loop` skill, **Anthropic adapter (Task 12)** → **Phase 3**.
- Looser JSON mode / per-endpoint fallback → **out of v1**; `needs_user_decision` if needed.

## Tasks pulled from the 21-task plan (with scope delta)

Implement these tasks **as written in the approved plan**, except for the deltas noted. Code
lives in the 21-task plan; do not re-author it — apply the cut.

| Task | Pull | Delta for Phase 1 |
|------|------|-------------------|
| 1 Scaffolding + types + errors | full | none |
| 2 Schema + structural validator | **partial** | Implement `REVIEW_SCHEMA` + `validateStructural` only. **Defer** `ROUND_ARTIFACT_SCHEMA`/`RESPONSES_ARTIFACT_SCHEMA` + their validators to Phase 2 (they validate persistence envelopes). |
| 4 Line-numbered rendering | full | none |
| 5 Criteria / requirement parser | **partial** | `parseCriteria` (`[CRIT-*]`) exercised. `parseRequirements` (`[REQ-*]`) may be implemented but is **unused** in spec stage; its plan-stage use is Phase 3. |
| 6 Verdict computation | full | Implement the full pure function; spec-stage path exercised (`upstreamCoverage`/`requirementIds` empty). |
| 7 Semantic — coverage rules | full | none (this is Phase-1 check #1). |
| 8 Semantic — lifecycle/feasibility/location | **partial** | Keep **only** finding-id uniqueness (#2), `feasibilityFindingIds` 3-way (#3), location bounds (#4). **Add** the Phase-1 stateless invariant (`status==="new"` and `supersededByFindingIds===[]` for every finding; else fail → repair). **Defer** provenance, carry-forward completeness, lifecycle transitions, and supersede linkage to Phase 2. |
| 9 Prompt builders | full | none |
| 10 Provider registry + identity guard | **partial** | Register the **OpenAI-compatible** provider only; thread a `baseURL` from the new `--reviewer-base-url`. Cross-model identity guard + always-required author identity: full. **Anthropic not registered** in P1 (Task 12 → Phase 3). |
| 11 OpenAI adapter | full | Already supports `baseURL`; wire the CLI flag through. Strict `json_schema`, `temperature: 0`, repair-once carries prior invalid output + errors. |
| 13 runReview | full | repair-once is schema/semantic only; an HTTP error from an unsupported `response_format` is a normal provider error (exit 2), **not** a repair trigger. |
| 18 Compare mode | full | Stateless, `{entries, failures}` to stdout (already so). Primary harness for the eval. |
| 19 Core orchestrator | **partial (stateless)** | Ship as a **distinct export `reviewOnce({...}) → {verdict, result}`**: the read→parse→prompt→`runReview`→verdict pipeline. **Omit** `selectLineage`, `writeRoundOnce`, `verifyApproval`, responses wiring. Do **not** name it `reviewDocument` — Phase 2's persisting `reviewDocument` *wraps* `reviewOnce`, so the Phase-1 contract is never mutated. Barrel exports only what Phase 1 ships. |
| 20 CLI | **partial** | Subcommands: `review` (stateless) + `compare`. Flags: positional `<doc>`, `--stage spec`, `--criteria`, `--reviewer-provider`/`--reviewer-model`/**`--reviewer-base-url`**, `--author-provider`/`--author-model`, `--allow-same-model`, `--compare`. **No** `respond`, `--prior`, `--prior-approval`, `--prior-log`, `--new-lineage`, `--out`. Exit 0 approved / 1 changes / 2 error; compare 0/2. |

Author identity remains **always required** (exit 2 if missing, even with `--allow-same-model`),
per the approved CLI contract.

## Preconditions

- **`spec-amendment-reviewer-base-url.md` is approved and incorporated into an approved spec
  v12.** Phase 1 depends on `--reviewer-base-url`; it must not be implemented before the
  amendment is approved. (Order: amendment review → spec v12 → Phase 1.)
- Node 18+, TypeScript ESM, vitest, ajv — per the 21-task plan Global Constraints.
- A reachable OpenAI-compatible reviewer endpoint (default OpenAI, or `--reviewer-base-url`) and
  its API key for the *manual evaluation* only. **Unit tests use no network** (mocked `fetch` /
  mocked `ReviewerProvider`).
- The empirical pass threshold and dataset (below) are **approved before** the first scored run
  (`needs_user_decision`).

## Interface handed to Phase 2

Phase 2 builds on these Phase-1 exports (stable contracts):

- `ReviewResult`, `Finding`, `Verdict`, `Severity`, `Stage`, `Identity`, `CriteriaMeta` (types).
- `REVIEW_SCHEMA`, `validateStructural`.
- `validateSemantic(result, ctx)` + `SemanticContext` — Phase 1 ships it running checks #1–#4
  **plus** the empty-`priorFindings` invariant; Phase 2 extends the **same** function/signature
  with provenance/carry-forward/transition/supersede checks (gated by `mode`/`priorFindings`,
  exactly as the 21-task plan's Task 8 design). The invariant keys off **empty `priorFindings`**,
  so Phase 2's multi-round path (non-empty priors, which legitimately produces non-`new` statuses)
  is unaffected.
- `runReview(args) → {result, verdict}`; `computeVerdict`; prompt builders; `renderLineNumbered`;
  `parseCriteria`; the OpenAI-compatible provider + registry + `assertCrossModel`.
- **Stateless `reviewOnce({...}) → {verdict, result}`** — Phase 2 adds a **separate**
  `reviewDocument({...}) → {verdict, result, roundPath}` that **calls** `reviewOnce` and layers
  persistence/lineage on top. `reviewOnce`'s signature and return type are **frozen** by Phase 1
  and never edited; this is what makes "a later phase never edits a prior contract" literally true.

## Test procedure (automated, no network)

Run each pulled task's tests per the 21-task plan (test-first; mocked providers). Phase-1
acceptance for the automated layer:

- `npx vitest run` green for the pulled scope, **adjusted counts** (Task 2 sheds the envelope
  tests → Phase 2; Task 8 sheds provenance/carry-forward/transition tests → Phase 2; Task
  19/20 use the stateless subset). Each phase-1 test file states its own expected count.
- `npm run build` (`tsc`) exits 0.
- A CLI smoke test (mocked provider): `review` prints `{verdict, result}` and exits 0/1;
  `compare` prints `{entries, failures}`; missing author identity → exit 2;
  `--reviewer-base-url` is threaded into the provider spec (assert via the mocked registry).
- **Approval-leak guard (required, P1):** a mocked reviewer returning a **required** finding with
  `status: "resolved"` (or any non-`new`) or a non-empty `supersededByFindingIds` must **fail the
  stateless invariant** → repair attempted → second failure → **exit 2**; it must **never** be
  treated as inactive and produce `approved`. Add the symmetric positive test: the same finding
  with `status:"new"` is active and yields `changes_requested`.

## Manual evaluation procedure (the Phase-1 gate)

This is a **human-adjudicated** evaluation, separate from unit tests. **Approved rules
(`needs_user_decision`-approved):**

### Dataset — two separate cohorts (do not mix a spec across cohorts)

- **Real cohort:** **at least 4** clean or naturally-occurring real specs. Used to measure
  *required-finding precision* and *serious false-positives*. Expand beyond 4 if evidence is
  short of the ≥10-required-findings floor (below).
- **Seeded cohort:** **at least 4** seeded copies derived from **separate** specs (not the
  real-cohort specs). Inject **≥ 10 independently identifiable defects total**. Used to measure
  *seeded-defect detection*.
- **≥ 8 specs total** (the two cohorts are disjoint). Different domains and spec sizes where
  practical.
- The original and the seeded version of the **same** spec must **not** both appear across
  cohorts.

### Ground truth (frozen before any scored run)

- For each seeded defect, freeze a **manifest** entry before running the reviewer:
  defect ID, location, category, severity, expected evidence, acceptable detection criteria.
- Keep the manifest **hidden from the reviewer**. Preserve untouched source specs separately.
- **Freeze** dataset, prompts, criteria, model identifiers, and thresholds before the first
  scored run.

### Adjudication

- Manually label **every** finding as exactly one of: `valid_actionable`,
  `valid_non_actionable`, `false_positive`.
- A **serious false-positive** = a **required** finding that would cause a material incorrect
  design change, an unnecessary scope expansion, or block approval based on a **false** claim.
- Seeded-cohort findings that are **not** in the manifest are adjudicated and **reported
  separately** as a secondary signal, but do **not** enter the scored precision / serious-FP
  metrics (those are real-cohort only — see Metrics). A seeded-cohort finding only counts toward
  *detection* if it matches a manifest defect (or is independently confirmed as a real defect).
- Report **optional** findings separately from **required** findings.

### Metrics (micro-aggregated across each cohort, not per-doc averaged)

- **Required-finding precision** — **real cohort only**, defined exactly as:

  ```
  precision = (real-cohort required findings adjudicated valid_actionable)
              ----------------------------------------------------------
              (all real-cohort required findings)
  ```

  Numerator counts **`valid_actionable` only** (not `valid_non_actionable`). Denominator is
  every required finding emitted on the real cohort.
- **Serious false-positive count** — **real cohort only** (a real-cohort required finding
  adjudicated `false_positive` meeting the "serious" bar).
- **Seeded-defect detection** — **seeded cohort only** (manifest defects detected / total
  manifest defects).
- Record results **separately per reviewer endpoint/model** configuration. Because `--compare`
  shares a single `--reviewer-base-url` (it varies the **model** only), evaluating **different
  endpoints** is done with **separate invocations** — one per `reviewerConfigs[]` entry in the
  run manifest — not within one `--compare` call.

### Pass thresholds (approved)

- Required-finding precision **≥ 70%** (formula above).
- Serious false-positives **≤ 1** **on the real cohort** (matches the metric; not "full dataset").
- Seeded-defect detection **≥ 80%**.
- **Evidence sufficiency:** ≥ 8 specs total, ≥ 10 seeded defects in the seeded cohort, and
  **≥ 10 required findings collected on the real cohort**. If fewer than 10 real-cohort required
  findings, the result is **"insufficient evidence,"** not passed (expand the real cohort and
  re-freeze a new run).
- **At least one** reviewer configuration must pass **all** gates.
- **No post-hoc tuning:** do not tune prompts, criteria, labels, or thresholds after inspecting
  results. Any tuning starts a **new versioned evaluation run** on a freshly frozen dataset.

> These are **Phase-1 pilot thresholds**, not a claim of production-grade quality.

### Evaluation artifacts (frozen file formats, for reproducibility)

Store under `eval/phase-1/<run-id>/` (`run-id` = a frozen label chosen before the run, e.g.
`2026-07-01-r1`). Three JSON files; all are append-only once the run is frozen.

- **`run-manifest.json`** — the frozen inputs:
  ```json
  {
    "runId": "2026-07-01-r1",
    "frozenAt": "2026-07-01T00:00:00Z",
    "promptVersion": "<git sha or tag>", "criteriaVersion": "<git sha or tag>",
    "schemaVersion": 1,
    "reviewerConfigs": [{ "id": "cfg-a", "provider": "openai", "model": "...", "baseUrl": "..." }],
    "realCohort":   [{ "specId": "R1", "path": "...", "sha256": "..." }],
    "seededCohort": [{ "specId": "S1", "path": "...", "sha256": "...",
                       "defects": [{ "defectId": "S1-D1", "location": "L42-50", "category": "...",
                                     "severity": "HIGH", "expectedEvidence": "...",
                                     "detectionCriteria": "..." }] }]
  }
  ```
  The seeded `defects[]` IS the hidden manifest; keep it out of anything fed to the reviewer.
- **`adjudication.json`** — one row per emitted finding, keyed by reviewer config + spec:
  ```json
  [{ "configId": "cfg-a", "specId": "R1", "cohort": "real", "findingId": "F1",
     "disposition": "required", "label": "valid_actionable",
     "matchedDefectId": null, "note": "..." }]
  ```
  `cohort` ∈ `real|seeded`; `label` ∈ `valid_actionable|valid_non_actionable|false_positive`;
  `matchedDefectId` links a seeded-cohort finding to a manifest defect (else `null`).
- **`metric-summary.json`** — computed, per reviewer config:
  ```json
  [{ "configId": "cfg-a",
     "realRequiredTotal": 12, "realValidActionable": 9, "precision": 0.75,
     "seriousFalsePositives": 0,
     "seededDefectsTotal": 11, "seededDefectsDetected": 10, "detection": 0.909,
     "evidenceSufficient": true, "passed": true }]
  ```
  `passed` is computed strictly from the thresholds above; `evidenceSufficient=false` forces
  `passed=false` ("insufficient evidence").

A new run (any tuning) uses a new `run-id`; prior runs are never edited.

## Completion conditions

Phase 1 is **complete** only when **both** hold:

1. Automated: all Phase-1 task tests pass and `tsc` builds clean.
2. Empirical: a frozen, scored evaluation run meets **all** pass thresholds for **≥ 1** reviewer
   configuration, with **sufficient evidence**, results recorded per endpoint/model.

## Abort / experiment-failure decision

If the evaluation **fails** a gate (or returns "insufficient evidence"):

- **Stop. Do not start Phase 2.** Persistence/lineage/approval are worthless on a reviewer that
  is not useful.
- Analyze the failure mode: reviewer **model/endpoint** quality, **prompt** quality, or
  **criteria** quality. Record the diagnosis.
- Any change to prompts/criteria/model is a **new versioned evaluation run** on a fresh frozen
  dataset (no post-hoc tuning of the failed run).
- Escalate options to the user as `needs_user_decision`: try a different reviewer config,
  revise the rubric, revise the prompt discipline, or reconsider the cross-model approach.
- **Rollback** is cheap: Phase 1 ships no durable artifacts, so there is nothing to migrate or
  unwind — the stateless reviewer simply remains a one-shot tool until the quality question is
  resolved.

## Deferred items (explicit)

Hashing · write-once rounds · response sidecar · lineage · `respond` · provenance/carry-forward/
transition/supersede validation (→ Phase 2). Plan-stage review · `[REQ-*]` upstream coverage ·
approval verification · Anthropic adapter · `review-loop` skill (→ Phase 3). Looser JSON mode /
per-endpoint fallback (→ out of v1; `needs_user_decision`).
