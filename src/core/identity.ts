import type { Identity } from "./types.js";
import { UsageError } from "./errors.js";

export function assertCrossModel(author: Identity, reviewer: Identity, allowSameModel: boolean): void {
  if (!allowSameModel && author.provider === reviewer.provider && author.model === reviewer.model) {
    throw new UsageError(
      `Reviewer (${reviewer.provider}:${reviewer.model}) equals the author; pass --allow-same-model to override.`
    );
  }
}
