import { describe, it, expect } from "vitest";
import { parseEnvFile, loadEnv } from "../../src/cli/env.js";

describe("parseEnvFile", () => {
  it("parses simple KEY=value lines", () => {
    expect(parseEnvFile("OPENAI_API_KEY=sk-123\nANTHROPIC_API_KEY=an-456"))
      .toEqual({ OPENAI_API_KEY: "sk-123", ANTHROPIC_API_KEY: "an-456" });
  });
  it("ignores blank lines and # comments", () => {
    expect(parseEnvFile("# a comment\n\nOPENAI_API_KEY=k\n   # indented comment\n"))
      .toEqual({ OPENAI_API_KEY: "k" });
  });
  it("strips an optional `export ` prefix", () => {
    expect(parseEnvFile("export OPENAI_API_KEY=k")).toEqual({ OPENAI_API_KEY: "k" });
  });
  it("strips matching single or double quotes around the value", () => {
    expect(parseEnvFile(`A="dq"\nB='sq'\nC=bare`)).toEqual({ A: "dq", B: "sq", C: "bare" });
  });
  it("keeps '=' that appears inside a value", () => {
    expect(parseEnvFile("OPENAI_BASE_URL=https://h/v1?x=1")).toEqual({ OPENAI_BASE_URL: "https://h/v1?x=1" });
  });
  it("trims surrounding whitespace on key and value", () => {
    expect(parseEnvFile("  OPENAI_API_KEY = k  ")).toEqual({ OPENAI_API_KEY: "k" });
  });
  it("skips malformed lines (no '=', leading '=', invalid key)", () => {
    expect(parseEnvFile("NOEQUALS\n=novalue\n1BAD=x\nGOOD=y")).toEqual({ GOOD: "y" });
  });
  it("returns an empty object for empty input", () => {
    expect(parseEnvFile("")).toEqual({});
  });
});

describe("loadEnv", () => {
  it("fills keys absent from the process environment", () => {
    const merged = loadEnv("OPENAI_API_KEY=from-file", { PATH: "/bin" });
    expect(merged.OPENAI_API_KEY).toBe("from-file");
    expect(merged.PATH).toBe("/bin");
  });
  it("lets a real exported env var WIN over the file (file never clobbers a live secret)", () => {
    const merged = loadEnv("OPENAI_API_KEY=from-file", { OPENAI_API_KEY: "from-shell" });
    expect(merged.OPENAI_API_KEY).toBe("from-shell");
  });
});
