#!/usr/bin/env node
import type { ProviderSpec, Stage } from "../core/types.js";
import { reviewOnce, buildReviewInputs } from "../core/index.js";
import { runCompare } from "../core/compare.js";
import { selectProvider } from "../core/providers/registry.js";
import { assertCrossModel } from "../core/identity.js";
import { UsageError } from "../core/errors.js";
import { fileURLToPath } from "node:url";

export interface CliIO { stdout: (s: string) => void; stderr: (s: string) => void }

export interface CliDeps {
  now?: () => string;
  makeProvider?: typeof selectProvider;
}

const VALUE_FLAGS = [
  "--stage", "--criteria", "--reviewer-provider", "--reviewer-model", "--reviewer-base-url",
  "--author-provider", "--author-model", "--compare", "--prior-log"
] as const;
const BOOL_FLAGS = ["--allow-same-model"] as const;

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
  const makeProvider = deps.makeProvider ?? selectProvider;
  try {
    const { doc, flags, bools } = parseArgs(argv);

    if (!doc) throw new UsageError("a <doc> path is required");
    const stage = flags["--stage"];
    if (!stage) throw new UsageError("--stage is required");
    if (stage !== "spec") throw new UsageError(`only --stage spec is supported in Phase 1, got "${stage}"`);
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
      return 0;
    }

    const provider = makeProvider({ provider: reviewerProvider, model: reviewerModel }, env2);
    const { verdict, result } = await reviewOnce({
      docPath: doc, stage: stage as Stage, criteriaPath,
      reviewer: { provider, model: reviewerModel },
      reviewerIdentity: { provider: reviewerProvider, model: reviewerModel },
      author, allowSameModel, priorFindings: [], priorResponses: []
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
