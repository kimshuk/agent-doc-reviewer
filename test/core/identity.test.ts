import { describe, it, expect } from "vitest";
import { assertCrossModel } from "../../src/core/identity.js";
import { UsageError } from "../../src/core/errors.js";

describe("assertCrossModel", () => {
  it("throws when author and reviewer share provider+model", () => {
    expect(() => assertCrossModel({ provider: "openai", model: "x" }, { provider: "openai", model: "x" }, false))
      .toThrow(UsageError);
  });
  it("allows same model when explicitly permitted", () => {
    expect(() => assertCrossModel({ provider: "openai", model: "x" }, { provider: "openai", model: "x" }, true))
      .not.toThrow();
  });
  it("allows differing identity", () => {
    expect(() => assertCrossModel({ provider: "anthropic", model: "a" }, { provider: "openai", model: "x" }, false))
      .not.toThrow();
  });
});
