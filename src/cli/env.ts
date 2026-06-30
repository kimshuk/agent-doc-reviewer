// Zero-dependency `.env` support for the CLI shim. Kept out of core (core stays process/fs-free).
// The two functions are pure so they are unit-testable; the actual file read + the merge into the
// live process environment happen in the untested entry shim at the bottom of cli/index.ts.

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Parse a `.env` file body into key/value pairs. Supports: `KEY=value`, an optional `export `
// prefix, `#` comments, blank lines, single/double-quoted values (matching quotes stripped), and
// `=` characters inside the value. Malformed lines (no `=`, empty key, invalid key name) are
// silently skipped — a `.env` is best-effort config, not a schema.
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;                                  // no '=', or a leading '=' (empty key)
    const key = body.slice(0, eq).trim();
    if (!KEY.test(key)) continue;
    let val = body.slice(eq + 1).trim();
    if (val.length >= 2 &&
        ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'")))
      val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

// Merge parsed file vars UNDER the live environment: a variable already present in the process
// environment (an exported shell secret) always wins, so a stray or accidentally-committed `.env`
// can never override a real credential. The file only fills what the shell left unset.
export function loadEnv(
  fileText: string, processEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  return { ...parseEnvFile(fileText), ...processEnv };
}
