# Phase 3 — Plan-stage Upstream Review, Approval Gating, Anthropic Adapter & Workflow Skill

> Final execution slice over the approved 21-task plan
> `docs/superpowers/plans/2026-06-22-review-doc.md`. Completes v1 to full spec parity. Begins
> after Phase 2. The 21-task plan and approved spec are unmodified. This is the **minimal**
> remaining phase that carries every later feature.

## Hypothesis & user value

**Hypothesis:** gating `spec → plan` on a **recompute-verified, hash-bound, deterministically
selected** spec approval — with `[REQ-*]` upstream coverage enforced — yields a trustworthy
staged authoring workflow; and provider parity (Anthropic reviewer) plus the `review-loop`
skill make the tool usable end-to-end by the coding agent.

**User value:** the full v1 — author a spec, get it approved, then review a *plan* against the
approved spec with its requirements enforced; the `review-loop` skill drives the whole loop;
the reverse cross-model direction (non-Claude author → Claude reviewer) becomes available.

## In scope

- **Approval-artifact verification** (plan stage): deterministic selection (highest round within
  a lineage; ambiguous multi-lineage → require `--prior-approval`), full-envelope validation,
  within-result semantics re-run, verdict recompute, `stage==="spec"` + `document_sha256` match.
- **Plan-stage activation** of already-built pieces: `parseRequirements` (`[REQ-*]`),
  `upstreamCoverage` exact-set validation, the verdict's `[REQ-*]` `not_met` gating branch,
  prior-spec line-numbered context.
- **Anthropic adapter** (Task 12): raw `fetch`, single forced tool, `tool_choice`,
  `anthropic-version`, repair-once — provider parity + reverse cross-model direction.
- CLI remainder: `--prior`, `--prior-approval`; plan-stage `review`/`compare` preflight
  (parse `[REQ-*]`, verify upstream approval), Anthropic as a `--reviewer-provider`.
- **`review-loop` SKILL.md** + example criteria + the full-suite gate.

## Out of scope (→ v2 backlog, per approved spec §9)

- MCP transport, plugin packaging, GLM/Gemini adapters, signing / full recursive provenance,
  lifecycle re-verification from an isolated artifact, enforcement hook, compare-mode
  persistence, looser JSON mode. None are added here.

## Tasks pulled from the 21-task plan (with scope delta)

| Task | Pull | Delta for Phase 3 |
|------|------|-------------------|
| 5 (plan-stage) | activate | `parseRequirements` (`[REQ-*]`) now exercised as `--prior` input. |
| 7 (plan-stage) | activate | `upstreamCoverage` exact-set + linkage vs `[REQ-*]`. |
| 12 Anthropic adapter | full | Deferred from Phase 1 (Disposition A). Forced tool-use structured output, repair-once. |
| 17 Approval-artifact verification | full | Deterministic selection + recompute + hash/stage/document checks. |
| 19 (plan-stage) | activate | Fill the **reserved** `ReviewDocumentInput` fields frozen in Phase 2 (`stage:"plan"`, `priorPath`, `priorApprovalPath`) — **no signature change**. Add the plan branch: `verifyApproval` + parse `[REQ-*]` + pass `prior: { path, text, requirementIds }` to the frozen `reviewOnce`. |
| 20 (plan-stage) | activate | `--prior`, `--prior-approval`; plan-stage `review`/`compare` preflight; Anthropic selectable as reviewer. |
| 21 Skill + example + full gate | full | `review-loop` SKILL.md, `examples/criteria.spec.md`, full `npm test && npm run build` gate. |

## Preconditions

- **Phase 2 complete** (immutable artifacts + lineage + persisting `reviewDocument` shipped;
  an approved spec round artifact exists to consume as `--prior`).
- Phase-2 interfaces available: `RoundArtifact`/persistence, `selectLineage`, finalized
  responses, persisting `reviewDocument`.

## Interface handed downstream

This phase closes v1; the downstream "interface" is the **full approved product**: every
`[REQ-*]` row **Verified** (`✅`, evidence-backed) in `phase-requirement-matrix.md`, all 21 tasks
implemented, the `review-loop` skill installable. v2 items remain in the approved spec §9 backlog.

## Test procedure (automated, no network)

- All pulled tasks' tests (test-first, mocked providers, no network), including: deterministic
  approval selection + ambiguity error, plan-stage `[REQ-*]` exact-set + verdict gating,
  Anthropic forced-tool request shape + repair, plan-stage compare against an approved prior,
  skill SKILL.md content checks.
- **Full gate:** `npm test && npm run build` — entire suite green, `tsc` exits 0.

## Manual evaluation procedure

- **End-to-end product walkthrough:** author a spec → approve it (Phase-2 loop) → review a real
  plan against it with `--prior` (confirm `[REQ-*]` coverage is enforced and a missing/`not_met`
  requirement blocks approval) → exercise the `review-loop` skill.
- **Provider-parity spot check (Disposition A boundary):** confirm the Anthropic adapter
  produces schema-valid output. Note: this *extends* provider coverage; it does **not** retro-
  actively generalize Phase-1's quality evidence to Anthropic-as-reviewer. If a quality claim is
  wanted for the Anthropic direction, run a **new** evaluation per the Phase-1 procedure
  (`needs_user_decision` for its threshold).

## Completion conditions

- Full suite + build green; all 21 tasks implemented; in `phase-requirement-matrix.md` every
  `[REQ-*]` row's **Verified** cell is `✅ verified` with an evidence link (not merely Target).
- End-to-end spec→approve→plan-review→skill loop works on real documents.

## Abort / experiment-failure decision

- Plan-stage approval gating is the highest-stakes integrity surface. If verification proves
  unsound in practice, **stop and raise `needs_user_decision`**; do not weaken the gate to make
  a case pass.
- **Rollback:** Phase 3 is additive over Phase 2. Disabling plan-stage (`--stage plan`) and the
  Anthropic provider reverts to the fully-working Phase-2 spec-stage tool with no artifact
  migration. The `review-loop` skill is a separate installable file and can be withheld
  independently.

## Deferred items (explicit)

Everything in the approved spec §9 v2 backlog (MCP, plugin packaging, GLM/Gemini, signing,
recursive provenance, lifecycle re-verification, enforcement hook, compare persistence, looser
JSON mode). Not implemented in v1.
