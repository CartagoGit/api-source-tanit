/**
 * Insomnia v4 exporter.
 *
 * Insomnia has no tree: its export file is a **flat list** of
 * resources where the hierarchy is expressed with `parentId`. A
 * workspace, some `request_group` hanging off it, and the requests
 * hanging off the groups.
 *
 * The ids must be **stable across generations**. Insomnia uses `_id`
 * to decide whether an import updates a resource or creates a new one;
 * with random ids, reimporting would duplicate the whole collection
 * every time. It is the same problem as Postman's `_postman_id`, and
 * it is solved the same way: by deriving them from content.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../../contracts/interfaces/core/export-target.interface.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import { topGroupFor, prettyGroupName } from "../helpers/uri.helper.js";
import { expandAllMethods } from "../helpers/all-method.helper.js";

/**
 * Stable id from a seed.
 *
 * It does not need to be cryptographic: it needs to be the same for
 * the same input and different for different inputs.
 */
function stableId(prefix: string, seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** `{{x}}` in Postman is also Insomnia's syntax. It is left untouched. */
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
    // Insomnia sorts by `metaSortKey` ascending. Without it, the order is
    // decided by the import and changes between runs.
    metaSortKey: index,
  };
}

/** Serializes the catalog to Insomnia's v4 export format. */
export class InsomniaExporter implements IExportTarget {
  readonly format = "insomnia";
  readonly summary = "Insomnia v4 (JSON) — the open-source alternative";

  serialize(input: IExportInput): IExportArtifact[] {
    const { config } = input;
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
        // The collection's variables go to the base environment: that is where
        // Insomnia looks when resolving `{{ baseUrl }}`.
        data: Object.fromEntries([
          ["baseUrl", config.baseUrl],
          ...config.variables.map((v) => [v.key, v.value]),
        ]),
      },
    ];

    // One group per folder, with the same grouping as the Postman
    // collection: two formats of the same project must show the same
    // structure.
    // x00056 S3: `ALL` is expanded into the seven standard verbs
    // before grouping so each verb lives in its own resource. Group
    // creation iterates over the expanded set so the seven operations
    // share the folder of the original (the URI and the folder are
    // preserved through expansion).
    const overrides = config.uriGroupOverrides ?? {};
    const expanded = expandAllMethods(input.specs);
    const groups = new Map<string, string>();
    for (const { spec } of expanded) {
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

    for (const [index, { spec }] of expanded.entries()) {
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
