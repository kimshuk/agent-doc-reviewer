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
  // --- finding id uniqueness (always) ---
  const idCounts = new Map<string, number>();
  for (const f of result.findings) idCounts.set(f.id, (idCounts.get(f.id) ?? 0) + 1);
  for (const [id, n] of idCounts) if (n > 1) errs.push(`duplicate finding id ${id}`);

  // --- feasibilityFindingIds 3-way (always) ---
  const act = activeIds(result), actReq = activeRequiredIds(result), all = allIds(result);
  for (const id of result.feasibilityFindingIds) {
    if (!all.has(id)) errs.push(`feasibilityFindingIds references unknown finding ${id}`);
    else if (!act.has(id)) errs.push(`feasibilityFindingIds references non-active finding ${id}`);
  }
  if (result.feasibility === "feasible" && result.feasibilityFindingIds.length > 0)
    errs.push("feasible must have empty feasibilityFindingIds");
  if (result.feasibility === "feasible_with_conditions" && result.feasibilityFindingIds.length === 0)
    errs.push("feasible_with_conditions requires >=1 active feasibilityFindingIds");
  if (result.feasibility === "not_feasible") {
    if (!result.feasibilityFindingIds.some(id => actReq.has(id)))
      errs.push("not_feasible requires >=1 active required feasibilityFindingIds");
  }

  // --- supersede linkage (always) ---
  // A superseded finding must point at an active replacement (an active required one when the
  // superseded finding was required); a non-superseded finding must not carry supersede links.
  for (const f of result.findings) {
    if (f.status === "superseded") {
      if (f.supersededByFindingIds.length === 0) errs.push(`superseded finding ${f.id} lists no replacement`);
      if (!f.supersededByFindingIds.some(id => act.has(id)))
        errs.push(`superseded finding ${f.id} has no active replacement`);
      if (f.disposition === "required" && !f.supersededByFindingIds.some(id => actReq.has(id)))
        errs.push(`required superseded finding ${f.id} has no active required replacement`);
    } else if (f.supersededByFindingIds.length > 0) {
      errs.push(`finding ${f.id} is not superseded but lists supersededByFindingIds`);
    }
  }

  if (ctx.mode === "full") {
    // --- provenance + carry-forward completeness (replaces the Phase-1 stateless invariant) ---
    // Every carried (non-"new") finding must trace to a prior id; a "new" id must not collide
    // with a prior id. With empty priors this collapses to the old approval-leak guard: any
    // non-"new" status has no provenance and fails, so a non-active finding cannot slip past
    // computeVerdict's active test. Every prior *active* finding must reappear exactly once with
    // an allowed next status (still_present | resolved | superseded); terminal priors may drop.
    const priorIds = new Set(ctx.priorFindings.map(f => f.id));
    const priorActive = ctx.priorFindings.filter(f => f.status === "new" || f.status === "still_present");
    for (const f of result.findings) {
      if (f.status === "new") {
        if (priorIds.has(f.id)) errs.push(`new finding ${f.id} collides with a prior id`);
      } else if (!priorIds.has(f.id)) {
        errs.push(`carried finding ${f.id} (${f.status}) has no prior provenance`);
      }
    }
    for (const pf of priorActive) {
      const matches = result.findings.filter(f => f.id === pf.id);
      if (matches.length !== 1) { errs.push(`prior active finding ${pf.id} must appear exactly once`); continue; }
      const s = matches[0].status;
      if (!(s === "still_present" || s === "resolved" || s === "superseded"))
        errs.push(`prior active finding ${pf.id} carried with invalid status ${s}`);
    }
    // --- location bounds ---
    for (const f of result.findings) {
      const lc = ctx.inputLineCounts[f.where.path];
      if (lc === undefined) { errs.push(`finding ${f.id} cites unknown path ${f.where.path}`); continue; }
      const { startLine, endLine } = f.where;
      if (startLine > endLine || endLine > lc)
        errs.push(`finding ${f.id} cites out-of-range lines ${startLine}-${endLine} (file has ${lc})`);
    }
  }

  return fail(errs);
}
