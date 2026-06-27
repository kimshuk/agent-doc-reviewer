import type { ReviewerProvider, ReviewResult, Verdict, CriteriaMeta, ReviewRequest } from "./types.js";
import { REVIEW_SCHEMA, validateStructural } from "./schema.js";
import { validateSemantic, type SemanticContext } from "./semantics.js";
import { computeVerdict } from "./verdict.js";
import { ValidationError } from "./errors.js";

export interface RunReviewArgs {
  provider: ReviewerProvider;
  system: string; user: string; model: string;
  ctx: SemanticContext; criteriaMeta: CriteriaMeta;
}

function validateAll(data: unknown, ctx: SemanticContext): { ok: true } | { ok: false; errors: string } {
  const s = validateStructural(data);
  if (!s.ok) return s;
  return validateSemantic(data as ReviewResult, ctx);
}

export async function runReview(args: RunReviewArgs): Promise<{ result: ReviewResult; verdict: Verdict }> {
  const baseReq: ReviewRequest = {
    system: args.system, user: args.user, schema: REVIEW_SCHEMA as object,
    model: args.model, temperature: 0
  };
  const first = await args.provider.review(baseReq);
  let chosen = first;
  let check = validateAll(first, args.ctx);
  if (!check.ok) {
    const repairReq: ReviewRequest = {
      ...baseReq,
      priorInvalidOutput: JSON.stringify(first),
      validationErrors: check.errors
    };
    const second = await args.provider.review(repairReq);
    const check2 = validateAll(second, args.ctx);
    if (!check2.ok) throw new ValidationError(`Reviewer output invalid after repair: ${check2.errors}`);
    chosen = second;
  }
  const result = chosen as ReviewResult;
  return { result, verdict: computeVerdict(result, args.criteriaMeta) };
}
