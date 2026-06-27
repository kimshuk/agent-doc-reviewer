import type { ReviewResult, Finding, CriteriaMeta, Stage, Coverage } from "./types.js";

export interface SemanticContext {
  stage: Stage;
  mode: "full" | "within_result";
  criteriaMeta: CriteriaMeta;
  requirementIds: string[];
  priorFindings: Finding[];
  inputLineCounts: Record<string, number>;
}

type Res = { ok: true } | { ok: false; errors: string };
const fail = (errs: string[]): Res => (errs.length ? { ok: false, errors: errs.join("; ") } : { ok: true });

const activeIds = (r: ReviewResult) =>
  new Set(r.findings.filter(f => f.status === "new" || f.status === "still_present").map(f => f.id));
const activeRequiredIds = (r: ReviewResult) =>
  new Set(r.findings.filter(f => (f.status === "new" || f.status === "still_present") && f.disposition === "required").map(f => f.id));
const allIds = (r: ReviewResult) => new Set(r.findings.map(f => f.id));

function checkCoverageSet(cov: Coverage[], expected: string[], label: string, errs: string[]): void {
  const got = cov.map(c => c.id);
  const seen = new Set<string>();
  for (const id of got) {
    if (!expected.includes(id)) errs.push(`${label} has unknown id ${id}`);
    if (seen.has(id)) errs.push(`${label} repeats id ${id}`);
    seen.add(id);
  }
  for (const id of expected) if (!seen.has(id)) errs.push(`${label} missing id ${id}`);
}

function checkCoverageLinkage(
  cov: Coverage[], requiredId: (id: string) => boolean, r: ReviewResult, label: string, errs: string[]
): void {
  const act = activeIds(r), actReq = activeRequiredIds(r), all = allIds(r);
  for (const c of cov) {
    for (const fid of c.findingIds) if (!all.has(fid)) errs.push(`${label} ${c.id} links unknown finding ${fid}`);
    if (c.assessment === "met" || c.assessment === "not_applicable") {
      if (c.findingIds.length) errs.push(`${label} ${c.id} is ${c.assessment} but lists findingIds`);
    }
    if (c.assessment === "not_applicable" && requiredId(c.id))
      errs.push(`${label} ${c.id} is required but marked not_applicable`);
    if (c.assessment === "partial" || c.assessment === "not_met") {
      const hasActive = c.findingIds.some(id => act.has(id));
      if (!hasActive) errs.push(`${label} ${c.id} is ${c.assessment} with no active finding`);
      if (requiredId(c.id) && !c.findingIds.some(id => actReq.has(id)))
        errs.push(`${label} ${c.id} is ${c.assessment} on a required item with no active required finding`);
    }
  }
}

export function validateSemantic(result: ReviewResult, ctx: SemanticContext): Res {
  const errs: string[] = [];
  // criteria coverage
  checkCoverageSet(result.criteriaCoverage, Object.keys(ctx.criteriaMeta), "criteriaCoverage", errs);
  checkCoverageLinkage(result.criteriaCoverage, id => !!ctx.criteriaMeta[id]?.required, result, "criteriaCoverage", errs);
  // upstream coverage
  if (ctx.stage === "spec") {
    if (result.upstreamCoverage.length) errs.push("upstreamCoverage must be empty in stage:spec");
  } else {
    checkCoverageSet(result.upstreamCoverage, ctx.requirementIds, "upstreamCoverage", errs);
    checkCoverageLinkage(result.upstreamCoverage, () => true, result, "upstreamCoverage", errs);
  }
  return fail(errs);
}
