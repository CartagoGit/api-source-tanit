/**
 * Bruno exporter.
 *
 * Bruno is the only one in the batch that is **not a file**: it is a
 * tree of folders with one `.bru` per request, in its own text format
 * meant to be readable in a Git diff. That is its reason for being,
 * and that is why the export contract returns a list of artifacts
 * rather than a string.
 *
 * The `.bru` format is whitespace-sensitive: blocks of `name { … }`
 * with two-space indentation and `key: value` inside. No quotes or
 * escapes, so a value with a line break would break the block — except
 * for `body:json`, which is the only one that allows free text
 * between braces.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../../contracts/interfaces/core/export-target.interface.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import { topGroupFor } from "../helpers/uri.helper.js";
import { expandAllMethods } from "../helpers/all-method.helper.js";
import { partitionHttpSpecs, warnSkippedNonHttpExports } from "../helpers/http-export-filter.helper.js";

/**
 * Converts a name into something that works as a file name.
 *
 * Bruno uses the `.bru` name in the interface, so it should stay
 * readable; but a `/` or `:` would break it on Windows.
 */
function toFileName(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return clean || "request";
}

/** A `name { … }` block with its lines already indented. */
function block(name: string, lines: ReadonlyArray<string>): string {
  if (lines.length === 0) return "";
  return `${name} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n`;
}

/** Bruno auth type for the method block. */
function authMode(auth: IExportInput["auth"]): string {
  switch (auth.type) {
    case "bearer":
      return "bearer";
    case "apikey":
      return "apikey";
    case "oauth2":
      return "oauth2";
    case "none":
      return "none";
  }
}

function toBru(spec: EndpointSpec, seq: number, input: IExportInput): string {
  const method = spec.method.toLowerCase();
  const parts: string[] = [];

  parts.push(
    block("meta", [`name: ${spec.name}`, "type: http", `seq: ${seq}`]),
  );

  parts.push(
    block(method, [
      `url: {{baseUrl}}${spec.uri}`,
      `body: ${spec.body !== undefined ? "json" : "none"}`,
      `auth: ${authMode(input.auth)}`,
    ]),
  );

  const headers = [
    "Accept: application/json",
    ...(spec.body !== undefined ? ["Content-Type: application/json"] : []),
    ...(spec.headers ?? []).map((h) => `${h.key}: ${h.value}`),
  ];
  parts.push(block("headers", headers));

  if (spec.query && spec.query.length > 0) {
    parts.push(block("params:query", spec.query.map((q) => `${q.key}: ${q.value}`)));
  }

  if (input.auth.type === "bearer") {
    parts.push(block("auth:bearer", ["token: {{token}}"]));
  } else if (input.auth.type === "apikey") {
    parts.push(
      block("auth:apikey", [
        `key: ${input.auth.keyName ?? "X-API-Key"}`,
        "value: {{apiKey}}",
        `placement: ${input.auth.keyIn ?? "header"}`,
      ]),
    );
  }

  if (spec.body !== undefined) {
    // `body:json` is the only block that allows free text: the JSON
    // goes in as-is, indented two spaces like the rest.
    const json = JSON.stringify(spec.body, null, 2)
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
    parts.push(`body:json {\n${json}\n}\n`);
  }

  if (spec.description) {
    parts.push(block("docs", spec.description.split("\n")));
  }

  return parts.filter(Boolean).join("\n");
}

/** Serializes the catalog to Bruno's `.bru` file tree. */
export class BrunoExporter implements IExportTarget {
  readonly format = "bruno";
  readonly summary = "Bruno (.bru) — Git-friendly folders, no cloud";

  serialize(input: IExportInput): IExportArtifact[] {
    const { config } = input;
    const { httpSpecs, skippedSpecs } = partitionHttpSpecs(input.specs);
    warnSkippedNonHttpExports(this.format, skippedSpecs);
    const root = `${config.name}.bruno`;
    const artifacts: IExportArtifact[] = [];

    // `bruno.json` is what makes Bruno recognize the folder as a
    // collection. Without it, the `.bru` tree does not open.
    artifacts.push({
      path: `${root}/bruno.json`,
      content:
        JSON.stringify(
          {
            version: "1",
            name: config.collectionName || config.name,
            type: "collection",
            ignore: ["node_modules", ".git"],
          },
          null,
          2,
        ) + "\n",
    });

    // Variables go in an environment, just like in the other formats.
    const vars = [
      `baseUrl: ${config.baseUrl}`,
      ...config.variables.map((v) => `${v.key}: ${v.value}`),
    ];
    artifacts.push({
      path: `${root}/environments/Local.bru`,
      content: block("vars", vars),
    });

    const overrides = config.uriGroupOverrides ?? {};
    // Bruno numbers the requests **within their folder**, not globally:
    // two `seq: 1` in different folders is correct.
    const seqByFolder = new Map<string, number>();
    const usedPaths = new Set<string>();

    // x00056 S3: Bruno's `method` block accepts the seven standard
    // verbs. `ALL` is expanded by the helper into one entry per verb.
    // The existing dedup loop (the `-2`, `-3`, … suffix) handles the
    // case where an expansion collides with an existing entry.
    for (const { spec } of expandAllMethods(httpSpecs)) {
      const folder = toFileName(spec.folder ?? topGroupFor(spec.uri, overrides));
      const seq = (seqByFolder.get(folder) ?? 0) + 1;
      seqByFolder.set(folder, seq);

      // Two endpoints can have the same name (`Get Users` from
      // `/users` and from `/users/{{id}}`). Without disambiguation,
      // the second would overwrite the first.
      let base = toFileName(`${spec.method}-${spec.name}`);
      let path = `${root}/${folder}/${base}.bru`;
      let n = 2;
      while (usedPaths.has(path)) {
        path = `${root}/${folder}/${base}-${n}.bru`;
        n++;
      }
      usedPaths.add(path);

      artifacts.push({ path, content: toBru(spec, seq, input) });
    }

    return artifacts;
  }
}
