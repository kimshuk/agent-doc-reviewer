import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("review-loop skill", () => {
  const skill = readFileSync("skills/review-loop/SKILL.md", "utf8");
  it("documents the core loop commands and the finalize step", () => {
    for (const needle of ["review-doc", "respond", "--prior-log", "--new-lineage", "needs_user_decision", "MAX_ROUNDS"])
      expect(skill).toContain(needle);
  });
  it("ships an example criteria file with at least one [CRIT-*] declaration", () => {
    const crit = readFileSync("examples/criteria.spec.md", "utf8");
    expect(/^[ \t]*[-*+][ \t]+\[CRIT-[A-Z0-9-]+\]/m.test(crit)).toBe(true);
  });
});
