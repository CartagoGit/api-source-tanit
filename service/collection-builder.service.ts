/**
 * Genera una colección Postman v2.1.0 a partir de un catálogo de
 * `EndpointSpec` agrupando los endpoints en carpetas automáticamente.
 *
 * El paquete es **agnóstico** del proyecto: el catálogo y la config
 * se pasan como parámetros a `buildCollection()`. Este archivo NO
 * importa ningún valor específico de ningún proyecto.
 *
 * Reglas de agrupación:
 *   1. Si el `EndpointSpec` trae `folder` explícito, se usa ese
 *      (útil para forzar subcarpetas como "Stock" o "Devoluciones"
 *      dentro de una zona padre común).
 *   2. Si no, se calcula con `topGroupFor(uri, uriGroupOverrides)`:
 *        - `/api/certificados` → grupo "certificados"
 *        - `/api/erp/productos` → grupo "erp"
 *        - `/api/integraciones/erp/...` → "integraciones"
 *        - `/api/pedidos/...` → "pedidos"
 *        - `/api/informes/mensual` → "informes" (si override)
 *   3. El nombre visible del folder se calcula con `prettyGroupName()`.
 */
import type {
  EndpointSpec,
  PostmanCollection,
  PostmanHeader,
  PostmanItem,
  PostmanRequest,
} from "../contract/postman.interface.js";
import type { ProjectConfig } from "../contract/project-config.interface.js";
import { POSTMAN_SCHEMA_URL } from "../contract/postman.constant.js";
import { prettyGroupName, topGroupFor } from "./route-parser.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultHeaders(): PostmanHeader[] {
  return [
    { key: "Accept", value: "application/json", type: "text" },
    { key: "Authorization", value: "Bearer {{token}}", type: "text" },
  ];
}

function buildRequest(ep: EndpointSpec): PostmanRequest {
  const req: PostmanRequest = {
    method: ep.method,
    header: defaultHeaders(),
    url: {
      raw: "{{baseUrl}}" + ep.uri,
      host: ["{{baseUrl}}"],
      path: ep.uri.split("/").filter(Boolean),
      ...(ep.query
        ? { query: ep.query.map((q) => ({ ...q, disabled: false })) }
        : {}),
    },
    description: ep.description ?? "",
  };
  // Headers personalizados opcionales (X-API-Key, headers de OpenAPI, etc.)
  if (ep.headers && ep.headers.length > 0) {
    req.header = [
      ...req.header,
      ...ep.headers.map((h) => ({
        key: h.key,
        value: h.value,
        type: "text" as const,
        ...(h.description ? { description: h.description } : {}),
      })),
    ];
  }
  if (ep.body !== undefined) {
    req.body = {
      mode: "raw",
      raw: JSON.stringify(ep.body, null, 2),
      options: { raw: { language: "json" } },
    };
    req.header = [
      { key: "Content-Type", value: "application/json", type: "text" },
      ...req.header,
    ];
  }
  return req;
}

function ep(spec: EndpointSpec): PostmanItem {
  return { name: spec.name, request: buildRequest(spec) };
}

function folder(
  name: string,
  items: PostmanItem[],
  description = "",
): PostmanItem {
  return { name, description, item: items };
}

/**
 * Carpeta lógica a la que pertenece un endpoint. Si el spec trae
 * `folder` se usa tal cual; si no, se deriva de la URI.
 */
function folderKeyFor(
  ep: EndpointSpec,
  uriGroupOverrides: Record<string, string>,
): string {
  if (ep.folder) return ep.folder;
  return topGroupFor(ep.uri, uriGroupOverrides);
}

/**
 * Nombre legible de una carpeta. Si la clave viene de `topGroupFor()`
 * aplicamos `prettyGroupName()`; si viene de un `folder` explícito lo
 * respetamos tal cual.
 */
function folderNameFor(key: string, isExplicit: boolean): string {
  return isExplicit ? key : prettyGroupName(key);
}

// ---------------------------------------------------------------------------
// Agrupación y construcción de la colección
// ---------------------------------------------------------------------------

interface FolderGroup {
  key: string;
  name: string;
  explicit: boolean;
  items: PostmanItem[];
}

/**
 * Toma el array plano de endpoints y devuelve las carpetas, en el orden
 * en que aparecen los specs (la primera vez que se ve una clave es la
 * que manda).
 *
 * Los items se agrupan por `(folderKey, topGroupFor(uri))` para que
 * un endpoint con `folder:"Productos"` y uri `/erp/productos` no se
 * mezcle con otro de `folder:"Productos"` y uri `/equivalencias`
 * (cada uno pertenece a un "Erp" y un "Productos" raíz distintos).
 */
function groupByFolder(
  specs: EndpointSpec[],
  uriGroupOverrides: Record<string, string>,
): FolderGroup[] {
  const order: string[] = [];
  const groups = new Map<string, FolderGroup>();

  for (const spec of specs) {
    const hasExplicit = !!spec.folder;
    const folderKey = folderKeyFor(spec, uriGroupOverrides);
    const top = topGroupFor(spec.uri, uriGroupOverrides);
    const compositeKey = `${folderKey}::${top}`;
    let g = groups.get(compositeKey);
    if (!g) {
      g = {
        key: folderKey,
        name: folderNameFor(folderKey, hasExplicit),
        explicit: hasExplicit,
        items: [],
      };
      groups.set(compositeKey, g);
      order.push(compositeKey);
    }
    if (hasExplicit) g.explicit = true;
    g.items.push(ep(spec));
  }

  return order.map((k) => groups.get(k)!);
}

interface HierarchicalFolder {
  mainKey: string;
  mainName: string;
  subs: Array<{ key: string; name: string; items: PostmanItem[] }>;
  direct: PostmanItem[];
}

function toHierarchical(
  groups: FolderGroup[],
  uriGroupOverrides: Record<string, string>,
): HierarchicalFolder[] {
  interface GroupWithMain {
    g: FolderGroup;
    autoMainKey: string;
  }
  const annotated: GroupWithMain[] = groups.map((g) => {
    const firstUrl = g.items[0]?.request?.url.raw ?? "";
    const uriForGroup = firstUrl.replace(/^\{\{baseUrl\}\}/, "");
    return {
      g,
      autoMainKey: topGroupFor(uriForGroup, uriGroupOverrides),
    };
  });

  const autoMainCounts = new Map<string, number>();
  for (const a of annotated) {
    autoMainCounts.set(
      a.autoMainKey,
      (autoMainCounts.get(a.autoMainKey) ?? 0) + 1,
    );
  }
  const reservedMainKeys = new Set<string>();
  for (const [key, count] of autoMainCounts) {
    if (count >= 2) reservedMainKeys.add(key);
  }
  for (const a of annotated) {
    if (!a.g.explicit) reservedMainKeys.add(a.autoMainKey);
  }
  const explicitAutoMainCounts = new Map<string, number>();
  for (const a of annotated) {
    if (a.g.explicit) {
      explicitAutoMainCounts.set(
        a.autoMainKey,
        (explicitAutoMainCounts.get(a.autoMainKey) ?? 0) + 1,
      );
    }
  }
  for (const [key, count] of explicitAutoMainCounts) {
    if (count >= 2) reservedMainKeys.add(key);
  }

  const order: string[] = [];
  const map = new Map<string, HierarchicalFolder>();

  for (const { g, autoMainKey } of annotated) {
    let mainKey: string;
    if (g.explicit) {
      if (reservedMainKeys.has(autoMainKey)) {
        mainKey = autoMainKey;
      } else if (reservedMainKeys.has(g.key)) {
        mainKey = g.key;
      } else {
        mainKey = g.key;
      }
    } else {
      mainKey = autoMainKey;
    }

    let h = map.get(mainKey);
    if (!h) {
      const mainName = prettyGroupName(mainKey);
      h = { mainKey, mainName, subs: [], direct: [] };
      map.set(mainKey, h);
      order.push(mainKey);
    }

    if (g.explicit) {
      if (g.key === mainKey) {
        h.direct.push(...g.items);
      } else {
        h.subs.push({ key: g.key, name: g.name, items: g.items });
      }
    } else {
      h.direct.push(...g.items);
    }
  }

  // Post-proceso: fusionar carpetas hermanas con el mismo `mainName`.
  const seen = new Map<string, HierarchicalFolder>();
  const finalOrder: string[] = [];
  for (const k of order) {
    const h = map.get(k)!;
    const prev = seen.get(h.mainName);
    if (!prev) {
      seen.set(h.mainName, h);
      finalOrder.push(k);
    } else {
      prev.direct.push(...h.direct);
      for (const sub of h.subs) prev.subs.push(sub);
    }
  }

  return finalOrder.map((k) => map.get(k)!);
}

/**
 * Construye la colección Postman a partir del catálogo de endpoints
 * y la configuración del proyecto.
 *
 * @param specs Catálogo de endpoints del proyecto.
 * @param config Configuración del proyecto (nombre, variables, zonas…).
 */
export function buildCollection(
  specs: EndpointSpec[],
  config: ProjectConfig,
): PostmanCollection {
  const overrides = config.uriGroupOverrides ?? {};
  const groups = groupByFolder(specs, overrides);
  const hierarchical = toHierarchical(groups, overrides);

  const topFolders: PostmanItem[] = hierarchical.map((h) => {
    const subFolders = h.subs.map((s) => folder(s.name, s.items));
    const children = [...subFolders, ...h.direct];
    return folder(h.mainName, children);
  });

  return {
    info: {
      name: config.collectionName,
      description: config.collectionDescription,
      schema: POSTMAN_SCHEMA_URL,
      _postman_id: crypto.randomUUID(),
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{token}}", type: "string" }],
    },
    variable: config.variables,
    item: topFolders,
  };
}

/**
 * Aplica el script de tests al endpoint de login para guardar el token
 * automáticamente. Agnóstico del proyecto:
 *
 * - `loginEndpointHints` lista de strings a buscar en el nombre del item
 *   (case-insensitive). Por defecto: ["login", "authenticate", "authenticate
 *   user", "obtain token"].
 * - `tokenPath` dot-path a la propiedad del token en la respuesta JSON.
 *   Ej: `"access_token"` (JWT/Laravel), `"data.access_token"` (Sanctum),
 *   `"data.token"`.
 *
 * Si no se detecta ningún endpoint coincidente, no se inyecta nada.
 */
export function attachLoginAutoToken(
  collection: PostmanCollection,
  options: {
    loginEndpointName?: string;
    loginEndpointHints?: ReadonlyArray<string>;
    tokenResponsePath?: string;
  } = {},
): void {
  const hints = (
    options.loginEndpointHints && options.loginEndpointHints.length > 0
      ? [...options.loginEndpointHints]
      : ["login", "authenticate", "obtain token", "get token"]
  ).map((s) => s.toLowerCase());
  const tokenPath = (options.tokenResponsePath ?? "").trim();
  const explicitName = options.loginEndpointName;

  function nameMatches(itemName: string): boolean {
    if (explicitName && itemName === explicitName) return true;
    const low = itemName.toLowerCase();
    return hints.some((h) => low.includes(h));
  }

  if (!tokenPath) return;

  // Genera script Postman que navega por el dot-path.
  const segments = tokenPath.split(".").map((s) => s.trim()).filter(Boolean);
  const navigate = segments
    .map((seg) => `    json.${seg} !== undefined ? json.${seg} :`)
    .join("\n")
    + " undefined";

  const script =
    "const json = pm.response.json();\n" +
    "if (json) {\n" +
    "    const token =\n" +
    `${navigate};\n` +
    "    if (typeof token === 'string' && token.length > 0) {\n" +
    "        pm.collectionVariables.set('token', token);\n" +
    "    }\n" +
    "}\n";

  function walk(items: PostmanItem[]): boolean {
    for (const item of items) {
      if (item.item) {
        if (walk(item.item)) return true;
        continue;
      }
      if (nameMatches(item.name)) {
        item.event = [
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: [
                "if (pm.response.code === 200) {",
                "    " + script.replace(/\n/g, "\n    "),
                "}",
              ],
            },
          },
        ];
        return true;
      }
    }
    return false;
  }
  walk(collection.item);
}
