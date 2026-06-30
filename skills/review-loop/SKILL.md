---
name: review-loop
description: Drive an iterative cross-model review of a spec or plan with review-doc — write/edit the doc, review with a different model, respond to each finding, re-run until approved or MAX_ROUNDS, then hand to the user for sign-off before advancing spec -> plan.
---

# review-loop

Use when iterating a spec or plan document through independent cross-model review.

## Preconditions

- `review-doc` CLI is built/available.
- A criteria file with `[CRIT-*]` declarations (see `examples/criteria.spec.md`).
- Reviewer credentials in env: `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`.
- The reviewer model MUST differ from the authoring model (the CLI enforces this unless `--allow-same-model`).

## Loop (MAX_ROUNDS default 3)

1. Write or edit the document.
2. Review it:
   - First round: `review-doc <doc.md> --stage spec --criteria <criteria.md> --reviewer-provider <p> --reviewer-model <m> --author-provider <ap> --author-model <am> --new-lineage`
   - Later rounds: same, but replace `--new-lineage` with `--prior-log <doc.md>.review/<lineageId>/round-<N>.json`.
   - Read the printed `{ verdict, result }`. Exit `0` = approved, `1` = changes_requested, `2` = error.
3. For EACH active finding (`status` new/still_present), decide one response:
   - fixed it in the doc -> `accepted_and_revised`
   - disagree, with proof -> `rejected_with_evidence` (include `evidence`)
   - already handled elsewhere -> `already_addressed` (include `evidence`)
   - needs the human -> `needs_user_decision`
4. Finalize the responses (write-once): write a JSON array of `{ findingId, response, evidence? }`, then
   `review-doc respond --round <doc.md>.review/<lineageId>/round-<N>.json --responses <responses.json>`.
5. If ANY response is `needs_user_decision`, STOP and hand to the user before re-running.
6. Re-run (step 2, later-round form). Stop when `verdict` is `approved` or after MAX_ROUNDS.
7. Hand the approved result to the user for sign-off.

## Advancing spec -> plan

`[REQ-*]` requirement tags are written into the spec **while authoring it**, BEFORE it is
reviewed and approved — they are part of the spec text, so `document_sha256` covers them.
Never add or edit `[REQ-*]` tags after approval: that changes the spec hash and invalidates
the approval the plan stage verifies (`document_sha256 == sha256(--prior)`).

Only after the user signs off on the spec:

- Review the plan against the already-tagged, approved spec:
  `review-doc <plan.md> --stage plan --criteria <plan-criteria.md> --prior <spec.md> --reviewer-provider <p> --reviewer-model <m> --author-provider <ap> --author-model <am> --new-lineage`
  (the CLI deterministically locates the spec's approved round under `<spec.md>.review/` and
  recompute-verifies it; if more than one lineage qualifies, pass `--prior-approval <round.json>`).

## Limitation

The gate is advisory: it records approval state but does not prevent advancing without sign-off. Respect the loop.
