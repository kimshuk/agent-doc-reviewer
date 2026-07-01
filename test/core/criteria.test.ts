import { describe, it, expect } from "vitest";
import { parseCriteria, parseRequirements, extractRequirementIds } from "../../src/core/criteria.js";
import { UsageError } from "../../src/core/errors.js";

describe("parseCriteria", () => {
  it("extracts ids and OPTIONAL from list-item declarations", () => {
    const md = "- [CRIT-SCOPE] keep small\n* [CRIT-STYLE OPTIONAL] consistent terms\n";
    const r = parseCriteria(md);
    expect(r.ids).toEqual(["CRIT-SCOPE", "CRIT-STYLE"]);
    expect(r.meta).toEqual({ "CRIT-SCOPE": { required: true }, "CRIT-STYLE": { required: false } });
  });
  it("ignores tags in prose, inline code, and fenced code blocks", () => {
    const md = [
      "Intro mentions [CRIT-NOPE] in prose.",
      "Inline `[CRIT-ALSO-NOPE]` too.",
      "```",
      "- [CRIT-FENCED] inside a code block",
      "```",
      "- [CRIT-REAL] the only real one"
    ].join("\n");
    expect(parseCriteria(md).ids).toEqual(["CRIT-REAL"]);
  });
  it("throws on duplicate ids", () => {
    expect(() => parseCriteria("- [CRIT-A] x\n- [CRIT-A] y")).toThrow(UsageError);
  });
  it("throws when no criteria are declared", () => {
    expect(() => parseCriteria("# Just prose")).toThrow(UsageError);
  });
});

describe("parseRequirements", () => {
  it("extracts [REQ-*] from list items only", () => {
    expect(parseRequirements("- [REQ-AUTH] must authn\n- [REQ-LOG] must log")).toEqual(["REQ-AUTH", "REQ-LOG"]);
  });
  it("throws on zero requirements", () => {
    expect(() => parseRequirements("no reqs here")).toThrow(UsageError);
  });
  it("throws on duplicate ids", () => {
    expect(() => parseRequirements("- [REQ-X] a\n- [REQ-X] b")).toThrow(UsageError);
  });
  it("ignores REQ tags in prose, extracts only anchored list items", () => {
    expect(parseRequirements("REQ-NOPE mentioned in prose\n- [REQ-OK] real")).toEqual(["REQ-OK"]);
  });
  it("extractRequirementIds returns [] when a document declares no [REQ-*]", () => {
    expect(extractRequirementIds("# Spec\nno tags here\n")).toEqual([]);
  });
  it("extractRequirementIds collects declared ids in order", () => {
    expect(extractRequirementIds("- [REQ-A] a\n- [REQ-B] b\n")).toEqual(["REQ-A", "REQ-B"]);
  });
  it("extractRequirementIds still throws on a duplicate id", () => {
    expect(() => extractRequirementIds("- [REQ-A] a\n- [REQ-A] a\n")).toThrow(/Duplicate requirement id/);
  });
});
