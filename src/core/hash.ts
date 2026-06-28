import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
export async function sha256OfFile(path: string): Promise<string> {
  return sha256(await readFile(path, "utf8"));
}
