import { describe, it, expect } from "vitest";
import { sha256, sha256OfFile } from "../../src/core/hash.js";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("hash", () => {
  it("computes a stable sha256 hex of a string", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("hashes file contents identically to the string hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-"));
    const p = join(dir, "f.txt"); await writeFile(p, "abc");
    expect(await sha256OfFile(p)).toBe(sha256("abc"));
  });
});
