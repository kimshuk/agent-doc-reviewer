import { describe, it, expect } from "vitest";
import { renderLineNumbered, lineCount } from "../../src/core/render.js";

describe("render", () => {
  it("prefixes each line with a padded line number", () => {
    expect(renderLineNumbered("a\nb")).toBe("L001 | a\nL002 | b");
  });
  it("counts lines", () => {
    expect(lineCount("a\nb\nc")).toBe(3);
    expect(lineCount("")).toBe(1);
  });
  it("widens the number column past 999 lines", () => {
    const text = Array.from({ length: 1000 }, (_, i) => String(i)).join("\n");
    expect(renderLineNumbered(text).startsWith("L0001 | 0\n")).toBe(true);
  });
});
