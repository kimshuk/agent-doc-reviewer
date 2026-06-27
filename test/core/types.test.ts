import { describe, it, expect } from "vitest";
import { UsageError, ValidationError } from "../../src/core/errors.js";

describe("scaffolding", () => {
  it("exports error classes with correct names", () => {
    expect(new UsageError("x").name).toBe("UsageError");
    expect(new ValidationError("y").name).toBe("ValidationError");
    expect(new UsageError("x")).toBeInstanceOf(Error);
  });
});
