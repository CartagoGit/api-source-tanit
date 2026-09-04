/**
 * Assertions carried by each request in the collection.
 *
 * A collection that only brings URLs and methods leaves all checking work to
 * the person importing it: they hit Send, inspect the response, and decide
 * with their eyes. The goal here is for the collection to **know** what a good
 * response is for each endpoint and report it itself.
 *
 * The rule governing this file is: **do not assert anything that is not
 * known**. It is the same as in `auth-scheme.service.ts`, for the same reason—
 * a false assertion is worse than none, because it fails visibly and sends
 * someone to investigate a problem that does not exist.
 *
 * Specifically:
 *
 *   - The expected status comes from the **method's semantics**, not a fixed
 *     200. A `POST` that creates responds 201, a `DELETE` responds 204 without
 *     a body, and requiring 200 from both would fail in a perfectly valid API.
 *     The range considered correct for that verb is accepted.
 *   - The body is checked **only when it is expected**. A 204 has no JSON,
 *     and `pm.response.json()` on an empty body throws.
 *   - The **shape** of the response is not checked. This project scans what
 *     the API **receives**; it does not know what it returns, and asserting
 *     that `GET /users` returns an array would be guessing.
 */
import type { EndpointSpec, PostmanEvent } from "../../contracts/interfaces/core/postman.interface.js";

/**
 * Status codes that count as a success for the verb.
 *
 * It is not 200 for everything: `POST` normally creates (201), `DELETE` often
 * responds without a body (204), and many APIs accept asynchronous work with
 * 202. We allow a reasonable set for each verb instead of forcing the API to
 * resemble one specific idea.
 */
const SUCCESS_CODES: Readonly<Record<string, ReadonlyArray<number>>> = {
  GET: [200, 204, 206],
  POST: [200, 201, 202, 204],
  PUT: [200, 201, 202, 204],
  PATCH: [200, 202, 204],
  DELETE: [200, 202, 204],
  HEAD: [200, 204],
  OPTIONS: [200, 204],
};

/** Status codes with no response body, so JSON is not requested. */
const NO_BODY_CODES = [204, 205, 304];

/**
 * How long a response may take before it deserves attention.
 *
 * It is a warning, not a contract: 2 seconds is generous for a local or
 * staging API, where a Postman collection is run.
 */
const SLOW_RESPONSE_MS = 2000;

/** Assertions for an endpoint, ready for the `event` field. */
export function buildTestScript(spec: EndpointSpec): PostmanEvent {
  const codes = SUCCESS_CODES[spec.method] ?? [200];
  const list = codes.join(", ");
  const mightHaveBody = codes.some((c) => !NO_BODY_CODES.includes(c));

  const exec: string[] = [
    `// Generado por Tanit. Se puede editar: no se`,
    `// sobreescribe al regenerar si cambias el nombre del test.`,
    `pm.test("Status is a success for ${spec.method}", function () {`,
    `    pm.expect([${list}]).to.include(pm.response.code);`,
    `});`,
    ``,
    `pm.test("Responds in under ${SLOW_RESPONSE_MS} ms", function () {`,
    `    pm.expect(pm.response.responseTime).to.be.below(${SLOW_RESPONSE_MS});`,
    `});`,
  ];

  if (mightHaveBody) {
    exec.push(
      ``,
      `// Un 204 no trae cuerpo, así que pedirle JSON lanzaría.`,
      `pm.test("Body is valid JSON when there is one", function () {`,
      `    if ([${NO_BODY_CODES.join(", ")}].includes(pm.response.code)) return;`,
      `    if (!(pm.response.headers.get("Content-Type") || "").includes("json")) return;`,
      `    pm.response.to.be.json;`,
      `});`,
    );
  }

  return { listen: "test", script: { type: "text/javascript", exec } };
}

/**
 * Adds assertions to an item without overwriting anything it already had.
 *
 * The login endpoint already has a script that saves the token, and the logout
 * endpoint has one that deletes it. Replacing the entire array would remove
 * them and the collection would stop authenticating itself—which is the reason
 * the auth flow exists.
 */
export function appendTestScript(
  existing: ReadonlyArray<PostmanEvent> | undefined,
  spec: EndpointSpec,
): PostmanEvent[] {
  return [...(existing ?? []), buildTestScript(spec)];
}
