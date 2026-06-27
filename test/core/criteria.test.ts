import { describe, it, expect } from "vitest";
import { parseCriteria, parseRequirements } from "../../src/core/criteria.js";
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
});
