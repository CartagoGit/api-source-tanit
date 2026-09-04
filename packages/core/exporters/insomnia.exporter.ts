/**
 * Exportador a Insomnia v4.
 *
 * Insomnia no tiene árbol: su fichero de exportación es una **lista
 * plana** de recursos donde la jerarquía se expresa con `parentId`. Un
 * workspace, unos `request_group` que cuelgan de él, y las requests que
 * cuelgan de los grupos.
 *
 * Los ids tienen que ser **estables entre generaciones**. Insomnia usa
 * el `_id` para decidir si una importación actualiza un recurso o crea
 * otro; con ids aleatorios, reimportar duplicaría la colección entera
 * cada vez. Es el mismo problema que el `_postman_id` de Postman, y se
 * resuelve igual: derivándolos del contenido.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../../contracts/interfaces/core/export-target.interface.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import { topGroupFor, prettyGroupName } from "../helpers/uri.helper.js";

/**
 * Id estable a partir de una semilla.
 *
 * No hace falta que sea criptográfico: hace falta que sea el mismo para
 * la misma entrada y distinto para entradas distintas.
 */
function stableId(prefix: string, seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** `{{x}}` de Postman es también la sintaxis de Insomnia. No se toca. */
function authHeaders(auth: IExportInput["auth"]): Array<{ name: string; value: string }> {
  if (auth.type === "apikey" && auth.keyIn === "header") {
    return [{ name: auth.keyName ?? "X-API-Key", value: "{{ apiKey }}" }];
  }
  return [];
}

function toRequest(
  spec: EndpointSpec,
  parentId: string,
  index: number,
  input: IExportInput,
): Record<string, unknown> {
  const headers: Array<{ name: string; value: string }> = [
    { name: "Accept", value: "application/json" },
    ...authHeaders(input.auth),
    ...(spec.headers ?? []).map((h) => ({ name: h.key, value: h.value })),
  ];
  if (spec.body !== undefined) {
    headers.unshift({ name: "Content-Type", value: "application/json" });
  }

  return {
    _id: stableId("req", `${spec.method} ${spec.uri}`),
    _type: "request",
    parentId,
    name: spec.name,
    description: spec.description ?? "",
    method: spec.method,
    url: `{{ baseUrl }}${spec.uri}`,
    headers,
    ...(spec.body !== undefined
      ? {
          body: {
            mimeType: "application/json",
            text: JSON.stringify(spec.body, null, 2),
          },
        }
      : {}),
    parameters: (spec.query ?? []).map((q) => ({
      name: q.key,
      value: q.value,
      disabled: false,
    })),
    authentication:
      input.auth.type === "bearer"
        ? { type: "bearer", token: "{{ token }}" }
        : {},
    // Insomnia ordena por `metaSortKey` ascendente. Sin él, el orden lo
    // decide la importación y cambia entre ejecuciones.
    metaSortKey: index,
  };
}

/** Serializa el catálogo al formato de exportación v4 de Insomnia. */
export class InsomniaExporter implements IExportTarget {
  readonly format = "insomnia";
  readonly summary = "Insomnia v4 (JSON) — the open-source alternative";

  serialize(input: IExportInput): IExportArtifact[] {
    const { specs, config } = input;
    const workspaceId = stableId("wrk", config.name);

    const resources: Array<Record<string, unknown>> = [
      {
        _id: workspaceId,
        _type: "workspace",
        parentId: null,
        name: config.collectionName || config.name,
        description: config.collectionDescription || "",
        scope: "collection",
      },
      {
        _id: stableId("env", config.name),
        _type: "environment",
        parentId: workspaceId,
        name: "Base Environment",
        // Las variables de la colección van al entorno base: es donde
        // Insomnia las busca al resolver `{{ baseUrl }}`.
        data: Object.fromEntries([
          ["baseUrl", config.baseUrl],
          ...config.variables.map((v) => [v.key, v.value]),
        ]),
      },
    ];

    // Un grupo por carpeta, con la misma agrupación que la colección de
    // Postman: dos formatos del mismo proyecto tienen que enseñar la
    // misma estructura.
    const overrides = config.uriGroupOverrides ?? {};
    const groups = new Map<string, string>();
    for (const spec of specs) {
      const key = spec.folder ?? topGroupFor(spec.uri, overrides);
      if (groups.has(key)) continue;
      const id = stableId("fld", `${config.name}:${key}`);
      groups.set(key, id);
      resources.push({
        _id: id,
        _type: "request_group",
        parentId: workspaceId,
        name: spec.folder ?? prettyGroupName(key),
        environment: {},
        metaSortKey: groups.size,
      });
    }

    for (const [index, spec] of specs.entries()) {
      const key = spec.folder ?? topGroupFor(spec.uri, overrides);
      resources.push(toRequest(spec, groups.get(key) ?? workspaceId, index, input));
    }

    const document = {
      _type: "export",
      __export_format: 4,
      __export_source: "tanit",
      resources,
    };
    return [
      {
        path: `${config.name}.insomnia.json`,
        content: JSON.stringify(document, null, 2) + "\n",
      },
    ];
  }
}
