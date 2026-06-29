#!/usr/bin/env node
import type { ProviderSpec, Stage, AuthorResponse } from "../core/types.js";
import { reviewDocument, buildReviewInputs } from "../core/index.js";
import { runCompare } from "../core/compare.js";
import { finalizeResponses } from "../core/responses.js";
import { selectProvider } from "../core/providers/registry.js";
import { assertCrossModel } from "../core/identity.js";
import { UsageError } from "../core/errors.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export interface CliIO { stdout: (s: string) => void; stderr: (s: string) => void }

export interface CliDeps {
  now?: () => string;
  mintLineageId?: () => string;
  makeProvider?: typeof selectProvider;
}

const VALUE_FLAGS = [
  "--stage", "--criteria", "--reviewer-provider", "--reviewer-model", "--reviewer-base-url",
  "--author-provider", "--author-model", "--compare", "--prior-log", "--out", "--round", "--responses"
] as const;
const BOOL_FLAGS = ["--allow-same-model", "--new-lineage"] as const;

interface Parsed {
  doc?: string;
  flags: Record<string, string>;
  bools: Set<string>;
}

function parseArgs(argv: string[]): Parsed {
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  let doc: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((VALUE_FLAGS as readonly string[]).includes(a)) {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} requires a value`);
      flags[a] = v;
    } else if ((BOOL_FLAGS as readonly string[]).includes(a)) {
      bools.add(a);
    } else if (a.startsWith("--")) {
      throw new UsageError(`Unknown option: ${a}`);
    } else if (doc === undefined) {
      doc = a;
    } else {
      throw new UsageError(`Unexpected argument: ${a}`);
    }
  }
  return { doc, flags, bools };
}

function parseTargets(spec: string): ProviderSpec[] {
  return spec.split(",").map(part => {
    const [provider, model] = part.split(":");
    if (!provider || !model) throw new UsageError(`--compare entry must be provider:model, got "${part}"`);
    return { provider, model };
  });
}

export async function main(
  argv: string[], env: Record<string, string | undefined>, io: CliIO, deps: CliDeps = {}
): Promise<number> {
  const now = deps.now ?? (() => new Date().toISOString());
  const mintLineageId = deps.mintLineageId ?? (() => `${now().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  const makeProvider = deps.makeProvider ?? selectProvider;
  try {
    const { doc, flags, bools } = parseArgs(argv);

    // `respond` finalizes the author-response sidecar beside an existing round artifact.
    if (doc === "respond") {
      // v1 contract: the sidecar is fixed beside its round, so respond takes NO --out — reject it
      // loudly rather than accept-and-ignore (which would mislead the caller).
      if (flags["--out"] !== undefined)
        throw new UsageError("--out is not supported by respond (the sidecar is fixed beside its round)");
      const roundPath = flags["--round"];
      if (!roundPath) throw new UsageError("respond requires --round <round-file>");
      const respFile = flags["--responses"];
      if (!respFile) throw new UsageError("respond requires --responses <file>");
      // --responses is a FILE only (no stdin) in v1.
      if (respFile === "-")
        throw new UsageError("reading --responses from stdin (-) is not supported in v1; pass a file path");
      const responses = JSON.parse(await readFile(respFile, "utf8")) as AuthorResponse[];
      const sidecar = await finalizeResponses(roundPath, responses);
      io.stdout(JSON.stringify({ finalized: sidecar }));
      return 0;
    }

    if (!doc) throw new UsageError("a <doc> path is required");
    const stage = flags["--stage"];
    if (!stage) throw new UsageError("--stage is required");
    if (stage !== "spec") throw new UsageError(`only --stage spec is supported (plan stage arrives in Phase 3), got "${stage}"`);
    const criteriaPath = flags["--criteria"];
    if (!criteriaPath) throw new UsageError("--criteria is required");

    const reviewerProvider = flags["--reviewer-provider"];
    const reviewerModel = flags["--reviewer-model"];
    if (!reviewerProvider || !reviewerModel) {
      throw new UsageError("--reviewer-provider and --reviewer-model are required");
    }
    const author = { provider: flags["--author-provider"] ?? "", model: flags["--author-model"] ?? "" };
    if (!author.provider || !author.model) {
      throw new UsageError("--author-provider and --author-model are required");
    }
    const allowSameModel = bools.has("--allow-same-model");

    const baseURL = flags["--reviewer-base-url"];
    const env2 = baseURL ? { ...env, OPENAI_BASE_URL: baseURL } : env;

    const compare = flags["--compare"];
    if (compare !== undefined) {
      if (flags["--prior-log"] !== undefined) {
        throw new UsageError("--prior-log cannot be combined with --compare (compare is fresh-only)");
      }
      const targets = parseTargets(compare);
      for (const t of targets) assertCrossModel(author, t, allowSameModel);
      const { system, user, ctx, criteriaMeta } = await buildReviewInputs({
        docPath: doc, stage: stage as Stage, criteriaPath, priorFindings: [], priorResponses: []
      });
      const entries = targets.map(t => ({ provider: makeProvider(t, env2), model: t.model }));
      const out = await runCompare({ entries, system, user, ctx, criteriaMeta, now });
      io.stdout(JSON.stringify({ entries: out.entries, failures: out.failures }));
      return out.allSucceeded ? 0 : 2;
    }

    const provider = makeProvider({ provider: reviewerProvider, model: reviewerModel }, env2);
    const { verdict, result } = await reviewDocument({
      docPath: doc, stage: stage as Stage, criteriaPath,
      reviewer: { provider, model: reviewerModel },
      reviewerIdentity: { provider: reviewerProvider, model: reviewerModel },
      author, allowSameModel,
      priorLogPath: flags["--prior-log"], newLineage: bools.has("--new-lineage"),
      outDir: flags["--out"], now, mintLineageId
    });
    io.stdout(JSON.stringify({ verdict, result }));
    return verdict === "approved" ? 0 : 1;
  } catch (err) {
    io.stderr((err as Error).message);
    return 2;
  }
}

// Process-entry shim (untested glue): the only place `process` lives, keeping core process-free.
// Runs when invoked as the bin, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const io: CliIO = {
    stdout: s => process.stdout.write(s + "\n"),
    stderr: s => process.stderr.write(s + "\n")
  };
  main(process.argv.slice(2), process.env, io).then(code => { process.exitCode = code; });
}
