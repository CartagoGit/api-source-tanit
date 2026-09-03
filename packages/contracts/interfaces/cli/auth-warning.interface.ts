/**
 * Aviso estructurado que `attachCredentialTemplate` emite cuando el
 * body del login no expone las claves que esperaba.
 *
 * Sale por `console.warn` como JSON de una sola línea, así un runner o
 * un parser externo puede leerlo sin regex sobre un mensaje libre.
 * Los tests sustituyen `console.warn` con `vi.spyOn` para verificarlo.
 *
 * Sale de `packages/core/domain/auth-flow.service.ts` (a00012 S3.b).
 * Vive aquí, no al lado del emisor, porque varios consumidores además
 * del propio `auth-flow` lo tipan para redirigir el aviso a otro sink
 * (tests e2e, runner JSON, UI de diagnostics).
 */
export interface IMissingCredentialsWarning {
  readonly kind: "missing-credentials";
  readonly reason: "no-json-body" | "no-credential-keys";
  /** `raw` de la URL del item, para que el aviso apunte al endpoint. */
  readonly path: string;
  /** Claves del body en el momento del aviso; sólo con `no-credential-keys`. */
  readonly keys?: ReadonlyArray<string>;
}
