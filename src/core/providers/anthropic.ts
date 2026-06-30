import type { ReviewerProvider, ReviewRequest } from "../types.js";

const TOOL_NAME = "emit_review";

export function createAnthropicProvider(opts: { apiKey: string }): ReviewerProvider {
  return {
    name: "anthropic",
    async review(req: ReviewRequest): Promise<unknown> {
      const messages: Array<{ role: string; content: string }> = [{ role: "user", content: req.user }];
      if (req.priorInvalidOutput !== undefined) {
        messages.push({ role: "assistant", content: req.priorInvalidOutput });
        messages.push({
          role: "user",
          content: `Your previous output failed validation: ${req.validationErrors ?? ""}. Call ${TOOL_NAME} again with corrected input.`
        });
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: req.model,
          temperature: req.temperature,
          max_tokens: 4096,
          system: req.system,
          messages,
          tools: [{ name: TOOL_NAME, description: "Emit the structured review result", input_schema: req.schema }],
          tool_choice: { type: "tool", name: TOOL_NAME }
        })
      });
      if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const block = (data?.content ?? []).find((b: any) => b.type === "tool_use");
      if (!block) throw new Error("Anthropic: no tool_use block in response");
      return block.input;
    }
  };
}
