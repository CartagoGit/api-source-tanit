/**
 * Postman inferred-response contract (proposal `f00014`).
 *
 * The implementation lives in
 * `packages/core/exporters/postman-inferred-response.exporter.ts`.
 * The contract lives here so MCP tools and exporters can describe
 * the Postman v2.1.0 `response[]` entry shape without depending on
 * the helper module.
 */

/** Single Postman v2.1.0 `response` entry. */
export interface IPostmanInferredResponse {
  readonly name: string;
  readonly status: string;
  readonly code: number;
  readonly _postman_previewlanguage?: string;
  readonly header: ReadonlyArray<{
    readonly key: string;
    readonly value: string;
    readonly type: "text";
  }>;
  readonly body: string;
}
