/**
 * Exportador a Bruno.
 *
 * Bruno es el único del lote que **no es un fichero**: es un árbol de
 * carpetas con un `.bru` por request, en un formato de texto propio
 * pensado para que un diff de Git se lea. Esa es su razón de ser, y por
 * eso el contrato de exportación devuelve una lista de artefactos y no
 * una cadena.
 *
 * El formato `.bru` es sensible a la forma: bloques `nombre { … }` con
 * dos espacios de sangría y `clave: valor` dentro. No lleva comillas ni
 * escapes, así que un valor con salto de línea rompería el bloque —
 * salvo en `body:json`, que es el único que admite texto libre entre
 * llaves.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../contracts/export-target.interface.js";
import type { EndpointSpec } from "../contracts/postman.interface.js";
import { topGroupFor } from "../helpers/uri.helper.js";

/**
 * Convierte un nombre en algo que vale como nombre de fichero.
 *
 * Bruno usa el nombre del `.bru` en la interfaz, así que conviene que
 * siga siendo legible; pero una `/` o un `:` lo romperían en Windows.
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

/** Un bloque `nombre { … }` con sus líneas ya sangradas. */
function block(name: string, lines: ReadonlyArray<string>): string {
  if (lines.length === 0) return "";
  return `${name} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n`;
}

/** El tipo de auth de Bruno para el bloque del método. */
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
    // `body:json` es el único bloque que admite texto libre: el JSON va
    // tal cual, sangrado dos espacios como el resto.
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

export class BrunoExporter implements IExportTarget {
  readonly format = "bruno";
  readonly summary = "Bruno (.bru) — Git-friendly folders, no cloud";

  serialize(input: IExportInput): IExportArtifact[] {
    const { specs, config } = input;
    const root = `${config.name}.bruno`;
    const artifacts: IExportArtifact[] = [];

    // `bruno.json` es lo que hace que Bruno reconozca la carpeta como
    // una colección. Sin él, el árbol de `.bru` no se abre.
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

    // Las variables van en un entorno, igual que en los otros formatos.
    const vars = [
      `baseUrl: ${config.baseUrl}`,
      ...config.variables.map((v) => `${v.key}: ${v.value}`),
    ];
    artifacts.push({
      path: `${root}/environments/Local.bru`,
      content: block("vars", vars),
    });

    const overrides = config.uriGroupOverrides ?? {};
    // Bruno numera las requests **dentro de su carpeta**, no globalmente:
    // dos `seq: 1` en carpetas distintas es lo correcto.
    const seqByFolder = new Map<string, number>();
    const usedPaths = new Set<string>();

    for (const spec of specs) {
      const folder = toFileName(spec.folder ?? topGroupFor(spec.uri, overrides));
      const seq = (seqByFolder.get(folder) ?? 0) + 1;
      seqByFolder.set(folder, seq);

      // Dos endpoints pueden llamarse igual (`Get Users` de `/users` y de
      // `/users/{{id}}`). Sin desambiguar, el segundo pisaría al primero.
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
