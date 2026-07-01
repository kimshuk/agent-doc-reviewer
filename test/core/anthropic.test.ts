import { describe, it, expect, vi, afterEach } from "vitest";
import { createAnthropicProvider } from "../../src/core/providers/anthropic.js";
import type { ReviewRequest } from "../../src/core/types.js";

const req: ReviewRequest = {
  system: "S", user: "U", schema: { type: "object" }, model: "claude-x", temperature: 0
};
function mockToolUse(input: unknown) {
  const body = { content: [{ type: "tool_use", name: "emit_review", input }] };
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => "" });
}
afterEach(() => vi.unstubAllGlobals());

describe("anthropic adapter", () => {
  it("forces tool_choice + temperature 0 and returns the tool input", async () => {
    const fetchMock = mockToolUse({ findings: [] });
    vi.stubGlobal("fetch", fetchMock);
    const p = createAnthropicProvider({ apiKey: "k" });
    const out = await p.review(req);
    expect(out).toEqual({ findings: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/messages");
    const sent = JSON.parse((init as any).body);
    expect(sent.temperature).toBe(0);
    expect(sent.tool_choice).toEqual({ type: "tool", name: sent.tools[0].name });
    expect(sent.tools[0].input_schema).toEqual({ type: "object" });
    expect((init as any).headers["x-api-key"]).toBe("k");
    expect((init as any).headers["anthropic-version"]).toBe("2023-06-01");
  });
  it("includes prior invalid output + errors on a repair call", async () => {
    const fetchMock = mockToolUse({ findings: [] });
    vi.stubGlobal("fetch", fetchMock);
    const p = createAnthropicProvider({ apiKey: "k" });
    await p.review({ ...req, priorInvalidOutput: "BAD", validationErrors: "missing findings" });
    const text = JSON.stringify(JSON.parse((fetchMock.mock.calls[0][1] as any).body).messages);
    expect(text).toContain("BAD");
    expect(text).toContain("missing findings");
  });
  it("throws on a non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate" }));
    const p = createAnthropicProvider({ apiKey: "k" });
    await expect(p.review(req)).rejects.toThrow(/429/);
  });
  it("generateStructured uses a caller-supplied schemaName and returns tool input", async () => {
    const body = { content: [{ type: "tool_use", name: "criteria_draft", input: { projectCriteria: [] } }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const p = createAnthropicProvider({ apiKey: "k" });
    const out = await p.generateStructured({
      system: "S", user: "U", schema: { type: "object" }, schemaName: "criteria_draft",
      model: "claude-x", temperature: 0
    });
    expect(out).toEqual({ projectCriteria: [] });
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(sent.tools[0].name).toBe("criteria_draft");
    expect(sent.tool_choice).toEqual({ type: "tool", name: "criteria_draft" });
    expect(JSON.stringify(sent)).not.toContain("emit_review");
  });
});
