/**
 * Structured warning emitted by `attachCredentialTemplate` when the
 * login body does not expose the keys it expected.
 *
 * Emitted via `console.warn` as single-line JSON, so a runner or an
 * external parser can read it without regexing a free message.
 * Tests replace `console.warn` with `vi.spyOn` to verify it.
 *
 * Emitted by `packages/core/domain/auth-flow.service.ts`
 * (a00012 S3.b). Lives here — not next to the emitter — because
 * several consumers besides `auth-flow` itself type this to
 * redirect the warning to another sink (e2e tests, JSON runner,
 * diagnostics UI).
 */
export interface IMissingCredentialsWarning {
  readonly kind: "missing-credentials";
  readonly reason: "no-json-body" | "no-credential-keys";
  /** URL raw of the item, so the warning points at the endpoint. */
  readonly path: string;
  /** Body keys at the moment of the warning; only with `no-credential-keys`. */
  readonly keys?: ReadonlyArray<string>;
}
