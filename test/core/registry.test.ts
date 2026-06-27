import { describe, it, expect } from "vitest";
import { selectProvider } from "../../src/core/providers/registry.js";
import { UsageError } from "../../src/core/errors.js";

describe("selectProvider", () => {
  it("builds an openai provider when its key is present", () => {
    const p = selectProvider({ provider: "openai", model: "gpt" }, { OPENAI_API_KEY: "k" });
    expect(p.name).toBe("openai");
  });
  it("throws for an anthropic reviewer (not available in Phase 1)", () => {
    expect(() => selectProvider({ provider: "anthropic", model: "claude" }, { ANTHROPIC_API_KEY: "k" }))
      .toThrow(UsageError);
  });
  it("throws on a missing key", () => {
    expect(() => selectProvider({ provider: "openai", model: "gpt" }, {})).toThrow(UsageError);
  });
  it("throws on an unknown provider", () => {
    expect(() => selectProvider({ provider: "mystery", model: "m" }, {})).toThrow(UsageError);
  });
});
