/**
 * Exporters to HAR 1.2 and to cURL.
 *
 * Both share the same idea — a concrete HTTP request, with no tool
 * wrapper — so they share a file.
 *
 * **HAR is a log format, not a template.** A real `.har` collects
 * requests that already happened, with their responses and their
 * timings. There are no responses here: nothing has ever been
 * executed. The spec requires the `response` on every entry, so we
 * emit the one HAR defines for "no response was captured" —
 * `status: 0`, empty body, sizes at -1. It is the format's
 * convention for exactly this case, and is preferable to inventing a
 * 200 with a body nobody has seen.
 *
 * Variables are intentionally left **unresolved** (`{{baseUrl}}`).
 * Substituting them with the config value would produce a file that
 * points to a specific environment, and whoever imports a HAR into
 * the DevTools usually wants to edit it before running it.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../../contracts/interfaces/core/export-target.interface.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import { expandAllMethods } from "../helpers/all-method.helper.js";

/** Headers carried by a request, per the auth scheme. */
function headersFor(
  spec: EndpointSpec,
  auth: IExportInput["auth"],
): Array<{ name: string; value: string }> {
  const headers: Array<{ name: string; value: string }> = [
    { name: "Accept", value: "application/json" },
  ];
  if (spec.body !== undefined) {
    headers.push({ name: "Content-Type", value: "application/json" });
  }
  if (auth.type === "bearer") {
    headers.push({ name: "Authorization", value: "Bearer {{token}}" });
  }
  if (auth.type === "apikey" && auth.keyIn === "header") {
    headers.push({ name: auth.keyName ?? "X-API-Key", value: "{{apiKey}}" });
  }
  for (const h of spec.headers ?? []) headers.push({ name: h.key, value: h.value });
  return headers;
}

/** Serializes the catalog to a HAR 1.2 log without responses. */
export class HarExporter implements IExportTarget {
  readonly format = "har";
  readonly summary = "HAR 1.2 (JSON) — DevTools and replay tools";

  serialize(input: IExportInput): IExportArtifact[] {
    const { config, auth } = input;

    // x00056 S3: HAR has no "all methods" verb. The expansion helper
    // turns every `method: "ALL"` spec into seven entries, one per
    // standard verb. The marker is dropped — HAR has no extension
    // mechanism for provenance metadata.
    const entries = expandAllMethods(input.specs).map(({ spec }) => {
      const headers = headersFor(spec, auth);
      const queryString = (spec.query ?? []).map((q) => ({
        name: q.key,
        value: q.value,
      }));
      return {
        startedDateTime: "1970-01-01T00:00:00.000Z",
        // -1 is what HAR uses for "not measured". A 0 would say it took
        // zero, which is a different statement.
        time: -1,
        request: {
          method: spec.method,
          url: `{{baseUrl}}${spec.uri}`,
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers,
          queryString,
          ...(spec.body !== undefined
            ? {
                postData: {
                  mimeType: "application/json",
                  text: JSON.stringify(spec.body),
                },
              }
            : {}),
          headersSize: -1,
          bodySize: -1,
        },
        // The no-response entry defined by the format. See the header.
        response: {
          status: 0,
          statusText: "",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [],
          content: { size: 0, mimeType: "application/json" },
          redirectURL: "",
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { send: -1, wait: -1, receive: -1 },
      };
    });

    const document = {
      log: {
        version: "1.2",
        creator: { name: "tanit", version: "1.0.0" },
        comment: `${config.collectionName || config.name} — requests that were never executed`,
        entries,
      },
    };
    return [
      {
        path: `${config.name}.har`,
        content: JSON.stringify(document, null, 2) + "\n",
      },
    ];
  }
}

/** Escapes a value to wrap it in single quotes in sh. */
function shellQuote(value: string): string {
  // In sh there are no escapes inside single quotes: you must close
  // them, insert an escaped quote, and reopen them.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Serializes the catalog to a shell script with one cURL per endpoint. */
export class CurlExporter implements IExportTarget {
  readonly format = "curl";
  readonly summary = "Shell script with one cURL per endpoint";

  serialize(input: IExportInput): IExportArtifact[] {
    const { config, auth } = input;
    const lines: string[] = [
      "#!/usr/bin/env sh",
      `# ${config.collectionName || config.name}`,
      "#",
      "# Generated by Tanit. Variables are read from the environment:",
      "# export whatever you need before running this.",
      "set -eu",
      "",
      `BASE_URL="\${BASE_URL:-${config.baseUrl}}"`,
    ];
    if (auth.type === "bearer") lines.push(`TOKEN="\${TOKEN:-}"`);
    if (auth.type === "apikey") lines.push(`API_KEY="\${API_KEY:-}"`);
    lines.push("");

    // x00056 S3 (scope extension): curl doesn't have an `ALL` verb
    // either. The helper expands the sentinel into seven lines, so
    // each verb becomes its own `curl -X VERB …` invocation. The
    // proposal lists five exporters; curl is the sixth and the same
    // bug would have produced `-X ALL` (curl error). Same fix.
    for (const { spec } of expandAllMethods(input.specs)) {
      // Postman variables become shell variables: a `{{id}}` in the URL
      // is not understood by curl.
      const uri = spec.uri.replace(/\{\{([^}]+)\}\}/g, (_, name: string) => `\${${name}}`);
      lines.push(`# ${spec.method} ${spec.name}`);

      const args: string[] = [
        `-X ${spec.method}`,
        `"$BASE_URL${uri}"`,
        `-H ${shellQuote("Accept: application/json")}`,
      ];
      if (auth.type === "bearer") args.push(`-H "Authorization: Bearer $TOKEN"`);
      if (auth.type === "apikey" && auth.keyIn === "header") {
        args.push(`-H "${auth.keyName ?? "X-API-Key"}: $API_KEY"`);
      }
      for (const h of spec.headers ?? []) {
        args.push(`-H ${shellQuote(`${h.key}: ${h.value}`)}`);
      }
      if (spec.body !== undefined) {
        args.push(`-H ${shellQuote("Content-Type: application/json")}`);
        args.push(`-d ${shellQuote(JSON.stringify(spec.body))}`);
      }

      lines.push(`curl ${args.join(" \\\n  ")}`);
      lines.push("");
    }

    return [{ path: `${config.name}.curl.sh`, content: lines.join("\n") }];
  }
}
