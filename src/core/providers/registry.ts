import type { ProviderSpec, ReviewerProvider } from "../types.js";
import { UsageError } from "../errors.js";
import { createOpenAIProvider } from "./openai.js";

export function selectProvider(
  spec: ProviderSpec, env: Record<string, string | undefined>
): ReviewerProvider {
  switch (spec.provider) {
    case "openai": {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) throw new UsageError("OPENAI_API_KEY is not set");
      return createOpenAIProvider({ apiKey, baseURL: env.OPENAI_BASE_URL });
    }
    default:
      throw new UsageError(
        `Unsupported reviewer provider: ${spec.provider} (Phase 1 supports openai-compatible only)`
      );
  }
}
