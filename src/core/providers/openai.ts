import type { ReviewerProvider, ReviewRequest, StructuredRequest } from "../types.js";

export function createOpenAIProvider(opts: { apiKey: string; baseURL?: string }): ReviewerProvider {
  const base = opts.baseURL ?? "https://api.openai.com/v1";
  return {
    name: "openai",
    async review(req: ReviewRequest): Promise<unknown> {
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: req.system },
        { role: "user", content: req.user }
      ];
      if (req.priorInvalidOutput !== undefined) {
        messages.push({ role: "assistant", content: req.priorInvalidOutput });
        messages.push({
          role: "user",
          content: `Your previous JSON failed validation: ${req.validationErrors ?? ""}. Return corrected JSON that conforms to the schema.`
        });
      }
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          temperature: req.temperature,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: { name: "review_result", strict: true, schema: req.schema }
          }
        })
      });
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("OpenAI: no message content");
      return JSON.parse(content);
    },
    async generateStructured(req: StructuredRequest): Promise<unknown> {
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: req.system },
        { role: "user", content: req.user }
      ];
      if (req.priorInvalidOutput !== undefined) {
        messages.push({ role: "assistant", content: req.priorInvalidOutput });
        messages.push({
          role: "user",
          content: `Your previous JSON failed validation: ${req.validationErrors ?? ""}. Return corrected JSON that conforms to the schema.`
        });
      }
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          temperature: req.temperature,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: { name: req.schemaName, strict: true, schema: req.schema }
          }
        })
      });
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("OpenAI: no message content");
      return JSON.parse(content);
    }
  };
}
