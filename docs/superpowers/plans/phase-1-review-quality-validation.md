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
— returns `{verdict, findings}` JSON usable for ad-hoc spec review *before* any persistence
exists. `--compare` runs several reviewer models side by side.

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
- Pure `computeVerdict` (spec-stage path: `approved` iff feasibility ≠ `not_feasible` and no
  active required finding and no `not_met` required criterion; `upstreamCoverage` empty).
- Constant prompt builders; line-numbered rendering; `[CRIT-*]` parsing.
- OpenAI-compatible reviewer adapter (raw `fetch`, strict `response_format.json_schema`,
  `temperature: 0`) + provider registry + cross-model identity guard + **`--reviewer-base-url`**
  (per `spec-amendment-reviewer-base-url.md`).
- **Stateless** `reviewDocument` (read → prompt → `runReview` → `{verdict, result}`; no
  persistence/lineage/approval).
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
| 8 Semantic — lifecycle/feasibility/location | **partial** | Keep **only** finding-id uniqueness (#2), `feasibilityFindingIds` 3-way (#3), location bounds (#4). **Defer** provenance, carry-forward completeness, lifecycle transitions, and supersede linkage to Phase 2. |
| 9 Prompt builders | full | none |
| 10 Provider registry + identity guard | **partial** | Register the **OpenAI-compatible** provider only; thread a `baseURL` from the new `--reviewer-base-url`. Cross-model identity guard + always-required author identity: full. **Anthropic not registered** in P1 (Task 12 → Phase 3). |
| 11 OpenAI adapter | full | Already supports `baseURL`; wire the CLI flag through. Strict `json_schema`, `temperature: 0`, repair-once carries prior invalid output + errors. |
| 13 runReview | full | repair-once is schema/semantic only; an HTTP error from an unsupported `response_format` is a normal provider error (exit 2), **not** a repair trigger. |
| 18 Compare mode | full | Stateless, `{entries, failures}` to stdout (already so). Primary harness for the eval. |
| 19 Core orchestrator | **partial (stateless)** | Implement the read→parse→prompt→`runReview`→verdict pipeline returning `{verdict, result}`. **Omit** `selectLineage`, `writeRoundOnce`, `verifyApproval`, responses wiring. Barrel exports only what Phase 1 ships. |
| 20 CLI | **partial** | Subcommands: `review` (stateless) + `compare`. Flags: positional `<doc>`, `--stage spec`, `--criteria`, `--reviewer-provider`/`--reviewer-model`/**`--reviewer-base-url`**, `--author-provider`/`--author-model`, `--allow-same-model`, `--compare`. **No** `respond`, `--prior`, `--prior-approval`, `--prior-log`, `--new-lineage`, `--out`. Exit 0 approved / 1 changes / 2 error; compare 0/2. |

Author identity remains **always required** (exit 2 if missing, even with `--allow-same-model`),
per the approved CLI contract.

## Preconditions

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
- `validateSemantic(result, ctx)` + `SemanticContext` — Phase 1 ships it running checks #1–#4;
  Phase 2 extends the **same** function/signature with provenance/carry-forward/transition/
  supersede checks (gated by `mode`/`priorFindings`, exactly as the 21-task plan's Task 8 design).
- `runReview(args) → {result, verdict}`; `computeVerdict`; prompt builders; `renderLineNumbered`;
  `parseCriteria`; the OpenAI-compatible provider + registry + `assertCrossModel`.
- Stateless `reviewDocument({...}) → {verdict, result}` — Phase 2 wraps/extends it with the
  persistence path (adds `roundPath`).

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

## Manual evaluation procedure (the Phase-1 gate)

This is a **human-adjudicated** evaluation, separate from unit tests. **Approved rules
(`needs_user_decision`-approved):**

### Dataset — two separate cohorts (do not mix a spec across cohorts)

- **Real cohort:** **4** clean or naturally-occurring real specs. Used to measure
  *required-finding precision* and *serious false-positives*.
- **Seeded cohort:** **4** seeded copies derived from **separate** specs (not the real-cohort
  specs). Inject **≥ 10 independently identifiable defects total**. Used to measure
  *seeded-defect detection*.
- **≥ 8 specs total.** Different domains and spec sizes where practical.
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
- Unexpected findings on the seeded cohort are adjudicated manually; they affect **precision**
  but **not** seeded-detection unless independently confirmed as real defects.
- Report **optional** findings separately from **required** findings.

### Metrics (micro-aggregated across the dataset, not per-doc averaged)

- **Required-finding precision** — computed on the **real cohort** only.
- **Serious false-positive count** — computed on the **real cohort** only.
- **Seeded-defect detection** — computed on the **seeded cohort** only.
- Record results **separately per reviewer endpoint/model** configuration.

### Pass thresholds (approved)

- Required-finding precision **≥ 70%**.
- Serious false-positives **≤ 1** across the full dataset.
- Seeded-defect detection **≥ 80%**.
- **Evidence sufficiency:** ≥ 8 specs, ≥ 10 seeded defects, **≥ 10 required findings collected**.
  If fewer than 10 required findings, the result is **"insufficient evidence,"** not passed.
- **At least one** reviewer configuration must pass **all** gates.
- **No post-hoc tuning:** do not tune prompts, criteria, labels, or thresholds after inspecting
  results. Any tuning starts a **new versioned evaluation run** on a freshly frozen dataset.

> These are **Phase-1 pilot thresholds**, not a claim of production-grade quality.

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
