/** Required product jobs. CI and local proof share these identifiers. */
export const PROOF_JOBS = [
  "typecheck", "lint", "affected-tests", "test-coverage", "validate-examples", "bench-check",
  "desktop-tests", "security-audit", "validate-package", "integration-verifier",
] as const;

/** These readers cannot safely be bounded by static TypeScript imports. */
export const PROOF_GLOBAL_PREFIXES = [
  ".github/", "scripts/", "tests/fixtures/", "tests/smoke-fixtures/", "tests/helpers/",
  "examples/", "integrations/", "bin/",
] as const;
