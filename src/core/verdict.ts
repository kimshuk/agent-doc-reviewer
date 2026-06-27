import type { ReviewResult, CriteriaMeta, Finding, Verdict } from "./types.js";

const active = (f: Finding) => f.status === "new" || f.status === "still_present";

export function computeVerdict(result: ReviewResult, criteriaMeta: CriteriaMeta): Verdict {
  const blockingFindings = result.findings.filter(f => f.disposition === "required" && active(f));
  const blockedCriteria = result.criteriaCoverage.filter(
    c => c.assessment === "not_met" && criteriaMeta[c.id]?.required
  );
  const blockedUpstream = result.upstreamCoverage.filter(c => c.assessment === "not_met");
  const ok =
    result.feasibility !== "not_feasible" &&
    blockingFindings.length === 0 &&
    blockedCriteria.length === 0 &&
    blockedUpstream.length === 0;
  return ok ? "approved" : "changes_requested";
}
