import type { ReviewerProvider, Verdict, ReviewResult, CriteriaMeta } from "./types.js";
import { runReview } from "./review.js";
import type { SemanticContext } from "./semantics.js";

export interface CompareEntry { provider: string; model: string; timestamp: string; verdict: Verdict; result: ReviewResult; }
export interface CompareFailure { provider: string; model: string; timestamp: string; error: string; }

export async function runCompare(args: {
  entries: Array<{ provider: ReviewerProvider; model: string }>;
  system: string; user: string; ctx: SemanticContext; criteriaMeta: CriteriaMeta; now: () => string;
}): Promise<{ entries: CompareEntry[]; failures: CompareFailure[]; allSucceeded: boolean }> {
  const entries: CompareEntry[] = [];
  const failures: CompareFailure[] = [];
  for (const e of args.entries) {
    const timestamp = args.now();
    try {
      const { result, verdict } = await runReview({
        provider: e.provider, system: args.system, user: args.user,
        model: e.model, ctx: args.ctx, criteriaMeta: args.criteriaMeta
      });
      entries.push({ provider: e.provider.name, model: e.model, timestamp, verdict, result });
    } catch (err) {
      failures.push({ provider: e.provider.name, model: e.model, timestamp, error: (err as Error).message });
    }
  }
  return { entries, failures, allSucceeded: failures.length === 0 };
}
