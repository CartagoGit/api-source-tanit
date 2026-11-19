/**
 * Read a flag from the command line, once.
 *
 * This six-line function was copied **four times**, and the copies
 * didn't match:
 *
 * | Where | Returns | Name |
 * |---|---|---|
 * | `project-loader.service` | `string \| null` | `readFlag` |
 * | `project-context.service` | `string \| undefined` | `readFlag` |
 * | `push.script` | `string \| null` | `readFlag` |
 * | `init.script` | `string \| null` | `flag(name, argv)` — arguments reversed |
 *
 * Two of them live in the core and disagree on how to say "not there".
 * That doesn't break the compiler and shows up later: whoever reads one
 * and writes `flag === undefined` is right in one and wrong in the
 * other three, because `null === undefined` is `false`. And the fourth
 * one also has the arguments in the opposite order, so copying a call
 * from one file to another compiles and does something else.
 *
 * ## Why `undefined` and not `null`
 *
 * Because that's what indexing an array out of range already returns,
 * which is where the value comes from. With `noUncheckedIndexedAccess`
 * on, `argv[i + 1]` **is** already `string | undefined`: returning
 * `null` forces a conversion, and that conversion is exactly where the
 * difference gets lost. Plus `?? ` works the same with both, so the
 * call site doesn't change.
 */

/**
 * The value of `--flag value`, or `undefined` if not present.
 *
 * Also accepts `--flag=value`, which is how half the people write it
 * and how almost every script generates it. Before, only the
 * space-separated form worked and the other one was silently ignored:
 * the flag looked like it wasn't there.
 */
export function readFlag(
  argv: ReadonlyArray<string>,
  name: string,
): string | undefined {
  const index = argv.indexOf(name);
  if (index !== -1) {
    const value = argv[index + 1];
    // `--output-dir --json` is not a value: it's the next flag.
    // Without this, `--output-dir` without a value takes `--json` with it.
    return value !== undefined && !value.startsWith("--") ? value : undefined;
  }
  const prefijo = `${name}=`;
  const pegado = argv.find((arg) => arg.startsWith(prefijo));
  return pegado?.slice(prefijo.length);
}

/** Is the flag present, with or without a value? */
export function hasFlag(argv: ReadonlyArray<string>, name: string): boolean {
  return argv.includes(name) || argv.some((arg) => arg.startsWith(`${name}=`));
}


/**
 * Reads a list of `name → result` mappings in one pass over `argv`.
 *
 * For each entry:
 *   - if `name` is `string`: returns the value (`undefined` if absent)
 *     under the same key in the result object.
 *   - if `name` is `string[]`: same shape, batch-friendly.
 *
 * Names with `=` (e.g. `--json`) are read with `hasFlag` semantics.
 *
 * The helper replaces the manual `args.indexOf(name)` blocks in the
 * CLI commands (audit 2026-09-06 §9, x00066 S1).
 */
export function readFlags<T extends Record<string, string>>(
  argv: ReadonlyArray<string>,
  names: T,
): { [K in keyof T]: string | undefined } {
  const result: Record<string, string | undefined> = {};
  for (const [key, name] of Object.entries(names)) {
    result[key] = readFlag(argv, name);
  }
  return result as { [K in keyof T]: string | undefined };
}

/** Reads multiple boolean flags in one pass. */
export function readBooleanFlags<T extends Record<string, string>>(
  argv: ReadonlyArray<string>,
  names: T,
): { [K in keyof T]: boolean } {
  const result: Record<string, boolean> = {};
  for (const [key, name] of Object.entries(names)) {
    result[key] = hasFlag(argv, name);
  }
  return result as { [K in keyof T]: boolean };
}

/**
 * Parse a `--flag a,b,c` style comma-separated list. Returns an empty
 * array when the flag is absent.
 */
export function readFlagList(
  argv: ReadonlyArray<string>,
  name: string,
): string[] {
  const value = readFlag(argv, name);
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}