/**
 * Centralized environment-variable resolver (x00067).
 *
 * Tanit is now branded Tanit (`b00001`). The code historically read
 * `POSTMAN_*` env vars; the docs already use `TANIT_*`. Without a
 * single resolver the two diverge every time a new env var is added.
 *
 * `envOrAlias("TANIT_X", "POSTMAN_X")`:
 *   - reads `TANIT_X` first (canonical),
 *   - falls back to `POSTMAN_X` (deprecated),
 *   - returns `undefined` when neither is set,
 *   - emits a one-time-per-process deprecation warning when the
 *     alias is the source.
 *
 * Set `process.env.TANIT_SUPPRESS_DEPRECATION = "1"` to silence the
 * warning (useful for the existing test fixtures that exercise the
 * legacy names).
 */
const warned = new Set<string>();

function isSuppressed(): boolean {
  return process.env["TANIT_SUPPRESS_DEPRECATION"] === "1";
}

/**
 * Resolves `canonical` (preferred) with `deprecated` (alias) as
 * fallback. Returns the trimmed value or `undefined`.
 */
export function envOrAlias(
  canonical: string,
  deprecated: string,
): string | undefined {
  const canonicalValue = process.env[canonical];
  if (canonicalValue !== undefined && canonicalValue.length > 0) {
    return canonicalValue.trim();
  }
  const deprecatedValue = process.env[deprecated];
  if (deprecatedValue !== undefined && deprecatedValue.length > 0) {
    if (!isSuppressed() && !warned.has(deprecated)) {
      warned.add(deprecated);
      console.warn(
        `[tanit] env var '${deprecated}' is deprecated; use '${canonical}' instead. ` +
          `The alias will be removed in a future major. ` +
          `Set TANIT_SUPPRESS_DEPRECATION=1 to silence this warning.`,
      );
    }
    return deprecatedValue.trim();
  }
  return undefined;
}

/** Resets the warning memoization (test-only escape hatch). */
export function __resetEnvAliasWarningsForTest(): void {
  warned.clear();
}