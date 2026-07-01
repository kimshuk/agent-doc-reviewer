#!/usr/bin/env node
import type { ProviderSpec, Stage, AuthorResponse } from "../core/types.js";
import { reviewDocument, buildReviewInputs, parseRequirements, generateCriteriaDraft } from "../core/index.js";
import { runCompare } from "../core/compare.js";
import { finalizeResponses } from "../core/responses.js";
import { verifyApproval } from "../core/approval.js";
import { selectProvider } from "../core/providers/registry.js";
import { assertCrossModel } from "../core/identity.js";
import { UsageError } from "../core/errors.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { loadEnv } from "./env.js";

export interface CliIO { stdout: (s: string) => void; stderr: (s: string) => void }

export interface CliDeps {
  now?: () => string;
  mintLineageId?: () => string;
  makeProvider?: typeof selectProvider;
}

const VALUE_FLAGS = [
  "--stage", "--criteria", "--reviewer-provider", "--reviewer-model", "--reviewer-base-url",
  "--author-provider", "--author-model", "--compare", "--prior-log", "--out", "--round", "--responses",
  "--prior", "--prior-approval", "--dotenv"
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

async function runCriteriaInit(
  argv: string[], env: Record<string, string | undefined>, io: CliIO, makeProvider: typeof selectProvider
): Promise<number> {
  if (argv[0] !== "init")
    throw new UsageError(`unknown criteria subcommand: ${argv[0] ?? "(none)"} (only 'init' is supported)`);

  const CRIT_VALUE_FLAGS = ["--generator-provider", "--generator-model", "--out", "--reviewer-base-url", "--dotenv"];
  const flags: Record<string, string> = {};
  let spec: string | undefined;
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (CRIT_VALUE_FLAGS.includes(a)) {
      const v = rest[++i];
      if (v === undefined) throw new UsageError(`${a} requires a value`);
      flags[a] = v;
    } else if (a.startsWith("--")) {
      throw new UsageError(`Unknown option: ${a}`);
    } else if (spec === undefined) {
      spec = a;
    } else {
      throw new UsageError(`Unexpected argument: ${a}`);
    }
  }
  if (!spec) throw new UsageError("criteria init requires a <spec> path");
  const genProvider = flags["--generator-provider"];
  const genModel = flags["--generator-model"];
  if (!genProvider || !genModel)
    throw new UsageError("--generator-provider and --generator-model are required");

  const outPath = flags["--out"] ?? `${spec}.criteria.md`;
  // Pre-check for a clean message; the wx write flag below closes the TOCTOU window.
  if (existsSync(outPath)) throw new UsageError(`refusing to overwrite existing file: ${outPath}`);

  const specText = await readFile(spec, "utf8");
  const baseURL = flags["--reviewer-base-url"];
  const env2 = baseURL ? { ...env, OPENAI_BASE_URL: baseURL } : env;
  const provider = makeProvider({ provider: genProvider, model: genModel }, env2);

  const { markdown, criteriaCount, reqPresent, reqCandidates } = await generateCriteriaDraft({
    specPath: spec, specText, provider, model: genModel
  });
  await mkdir(dirname(outPath), { recursive: true });   // criteria often collected under a dedicated dir
  await writeFile(outPath, markdown, { flag: "wx" });   // wx: fail if the file appeared meanwhile

  if (reqPresent.length === 0)
    io.stderr(`warning: '${spec}' declares no [REQ-*] tags; ${reqCandidates.length} suggested requirement(s) written to '${outPath}' — copy them into the spec before review`);
  io.stdout(JSON.stringify({ written: outPath, criteriaCount, reqPresent, reqCandidateCount: reqCandidates.length }));
  return 0;
}

export async function main(
  argv: string[], env: Record<string, string | undefined>, io: CliIO, deps: CliDeps = {}
): Promise<number> {
  const now = deps.now ?? (() => new Date().toISOString());
  const mintLineageId = deps.mintLineageId ?? (() => `${now().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  const makeProvider = deps.makeProvider ?? selectProvider;
  try {
    // `criteria init` takes two positionals (`criteria` `init` <spec>), which the generic parseArgs
    // would reject — so branch on it before parseArgs runs.
    if (argv[0] === "criteria") {
      return await runCriteriaInit(argv.slice(1), env, io, makeProvider);
    }

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
      const parsed = JSON.parse(await readFile(respFile, "utf8")) as unknown;
      if (!Array.isArray(parsed))
        throw new UsageError("--responses file must contain a JSON array of author responses");
      const responses = parsed as AuthorResponse[];
      const sidecar = await finalizeResponses(roundPath, responses);
      io.stdout(JSON.stringify({ finalized: sidecar }));
      return 0;
    }

    if (!doc) throw new UsageError("a <doc> path is required");
    // --round/--responses belong to the respond subcommand only; reject (don't silently ignore)
    // them on the review/compare path, the same accept-and-ignore failure the --out guard avoids.
    if (flags["--round"] !== undefined || flags["--responses"] !== undefined)
      throw new UsageError("--round/--responses are only valid with the `respond` subcommand");
    const stage = flags["--stage"];
    if (!stage) throw new UsageError("--stage is required");
    if (stage !== "spec" && stage !== "plan") throw new UsageError(`--stage must be spec or plan, got "${stage}"`);
    if (stage === "spec" && (flags["--prior"] !== undefined || flags["--prior-approval"] !== undefined))
      throw new UsageError("--prior/--prior-approval are only valid with --stage plan");
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
      let prior: { path: string; text: string; requirementIds: string[] } | undefined;
      if (stage === "plan") {
        const priorPath = flags["--prior"];
        if (!priorPath) throw new UsageError("--stage plan requires --prior <approved upstream spec>");
        const priorText = await readFile(priorPath, "utf8");
        await verifyApproval({ approvalPath: flags["--prior-approval"], priorPath, priorReviewDir: `${priorPath}.review` });
        prior = { path: priorPath, text: priorText, requirementIds: parseRequirements(priorText) };
      }
      const { system, user, ctx, criteriaMeta } = await buildReviewInputs({
        docPath: doc, stage: stage as Stage, criteriaPath, prior, priorFindings: [], priorResponses: []
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
      outDir: flags["--out"], now, mintLineageId,
      priorPath: flags["--prior"], priorApprovalPath: flags["--prior-approval"]
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
  // Load a `.env` file (default `.env` in CWD, or `--dotenv <path>`) into the environment BEFORE
  // main reads any credential. A real exported shell var always wins over the file (see loadEnv),
  // so a stray `.env` can't override a live secret. An explicit `--dotenv` that does not exist is a
  // hard error; a missing default `.env` is silently skipped (env-file support is opt-in).
  // NOTE: the flag is `--dotenv`, NOT `--env-file` — Node's own built-in `--env-file` would
  // intercept that name before this script ever sees it.
  const argv = process.argv.slice(2);
  const efIdx = argv.indexOf("--dotenv");
  const envPath = efIdx >= 0 ? argv[efIdx + 1] : ".env";
  if (efIdx >= 0 && (envPath === undefined || !existsSync(envPath))) {
    io.stderr(`--dotenv file not found: ${envPath ?? "(missing path)"}`);
    process.exitCode = 2;
  } else {
    const fileText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    main(argv, loadEnv(fileText, process.env), io).then(code => { process.exitCode = code; });
  }
}
