import type { ReviewerProvider } from "../types.js";
export function createOpenAIProvider(_opts: { apiKey: string; baseURL?: string }): ReviewerProvider {
  return { name: "openai", async review() { throw new Error("not implemented"); } };
}
