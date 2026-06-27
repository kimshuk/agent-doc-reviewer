import type { CriteriaMeta } from "./types.js";
import { UsageError } from "./errors.js";

export interface ParsedCriteria { ids: string[]; meta: CriteriaMeta; }

const FENCE = /^[ \t]*(```|~~~)/;
const CRIT = /^[ \t]*[-*+][ \t]+\[(CRIT-[A-Z0-9-]+)( OPTIONAL)?\]/;
const REQ = /^[ \t]*[-*+][ \t]+\[(REQ-[A-Z0-9-]+)\]/;

export function parseCriteria(markdown: string): ParsedCriteria {
  const ids: string[] = [];
  const meta: CriteriaMeta = {};
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(CRIT);
    if (!m) continue;
    const id = m[1];
    if (id in meta) throw new UsageError(`Duplicate criterion id: ${id}`);
    meta[id] = { required: m[2] === undefined };
    ids.push(id);
  }
  if (ids.length === 0) throw new UsageError("No [CRIT-*] criteria declared in --criteria");
  return { ids, meta };
}

export function parseRequirements(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(REQ);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) throw new UsageError(`Duplicate requirement id: ${id}`);
    seen.add(id); ids.push(id);
  }
  if (ids.length === 0) throw new UsageError("No [REQ-*] requirements declared in --prior");
  return ids;
}
