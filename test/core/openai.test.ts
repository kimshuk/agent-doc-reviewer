import { describe, it, expect, vi, afterEach } from "vitest";
import { createOpenAIProvider } from "../../src/core/providers/openai.js";
import type { ReviewRequest } from "../../src/core/types.js";

const req: ReviewRequest = {
  system: "S", user: "U", schema: { type: "object" }, model: "gpt-x", temperature: 0
};
function mockFetchOnce(payloadObj: unknown) {
  const body = { choices: [{ message: { content: JSON.stringify(payloadObj) } }] };
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => "" });
}
afterEach(() => vi.unstubAllGlobals());

describe("openai adapter", () => {
  it("posts json_schema strict + temperature 0 and returns parsed content", async () => {
    const fetchMock = mockFetchOnce({ findings: [] });
    vi.stubGlobal("fetch", fetchMock);
    const p = createOpenAIProvider({ apiKey: "k" });
    const out = await p.review(req);
    expect(out).toEqual({ findings: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.openai.com/v1/chat/completions");
    const sent = JSON.parse((init as any).body);
    expect(sent.temperature).toBe(0);
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect((init as any).headers.Authorization).toBe("Bearer k");
  });
  it("honors a custom baseURL", async () => {
    const fetchMock = mockFetchOnce({ findings: [] });
    vi.stubGlobal("fetch", fetchMock);
    const p = createOpenAIProvider({ apiKey: "k", baseURL: "https://glm.example/v1" });
    await p.review(req);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://glm.example/v1/chat/completions");
  });
  it("includes prior invalid output and errors on a repair call", async () => {
    const fetchMock = mockFetchOnce({ findings: [] });
    vi.stubGlobal("fetch", fetchMock);
    const p = createOpenAIProvider({ apiKey: "k" });
    await p.review({ ...req, priorInvalidOutput: "BAD", validationErrors: "missing findings" });
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    const text = JSON.stringify(sent.messages);
    expect(text).toContain("BAD");
    expect(text).toContain("missing findings");
  });
  it("throws on a non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
    const p = createOpenAIProvider({ apiKey: "k" });
    await expect(p.review(req)).rejects.toThrow(/500/);
  });
  it("generateStructured names the json_schema from schemaName", async () => {
    const body = { choices: [{ message: { content: JSON.stringify({ projectCriteria: [] }) } }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const p = createOpenAIProvider({ apiKey: "k" });
    const out = await p.generateStructured({
      system: "S", user: "U", schema: { type: "object" }, schemaName: "criteria_draft",
      model: "gpt-x", temperature: 0
    });
    expect(out).toEqual({ projectCriteria: [] });
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(sent.response_format.json_schema.name).toBe("criteria_draft");
    expect(JSON.stringify(sent)).not.toContain("review_result");
  });
});
