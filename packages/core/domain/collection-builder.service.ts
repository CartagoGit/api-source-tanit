/**
 * Builds a Postman v2.1.0 collection from an `EndpointSpec` catalog,
 * grouping the endpoints into folders automatically.
 *
 * The package is **agnostic** to the project: the catalog and the
 * config are passed as parameters to `buildCollection()`. This file
 * does NOT import any project-specific value.
 *
 * Grouping rules:
 *   1. If the `EndpointSpec` carries an explicit `folder`, that one is
 *      used (useful to force subfolders like "Stock" or "Returns"
 *      inside a common parent zone).
 *   2. Otherwise it is computed with `topGroupFor(uri, uriGroupOverrides)`:
 *        - `/api/certificates` -> group "certificates"
 *        - `/api/erp/products`  -> group "erp"
 *        - `/api/integrations/erp/...` -> "integrations"
 *        - `/api/orders/...` -> "orders"
 *        - `/api/reports/monthly` -> "reports" (if override)
 *   3. The folder's display name is computed with `prettyGroupName()`.
 */
import type {
  EndpointSpec,
  IEndpointAuth,
  PostmanCollection,
  PostmanHeader,
  PostmanItem,
  PostmanRequest,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import { collectionIdFor } from "../helpers/collection-identity.helper.js";
import { POSTMAN_SCHEMA_URL } from "../../contracts/constants/core/postman.constant.js";
import { detectAuthScheme, toPostmanAuth } from "./auth-scheme.service.js";
import { buildRequestDescription } from "./request-doc.service.js";
import { bodyFieldsFromGraph } from "../helpers/schema-flatten.helper.js";
import { buildTestScript } from "./test-script.service.js";
import { prettyGroupName, topGroupFor } from "../helpers/uri.helper.js";
import { postmanMethodFor } from "./postman-method.helper.js";
import type { AuthSchemeType, IDetectedAuthScheme } from "../../contracts/interfaces/core/discovery.interface.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Headers carried by every request.
 *
 * `Authorization: Bearer {{token}}` only when the API **uses** bearer.
 * It used to be sent on every request, so an API with no auth at all
 * was sending `Bearer ` with the unresolved variable on every call,
 * and the response was a 401 that had nothing to do with what was
 * being tested. The same goes for API key: the collection `auth`
 * block already places the key where it belongs.
 *
 * Per-operation override (`a00012 S3.b`): if the endpoint carries
 * `auth: { kind: "none" }`, the `Authorization` header is omitted for
 * that request even when the global scheme is bearer. This is the case
 * of public endpoints -- login, /health, /register -- that must not
 * carry credentials: the token does not exist yet when they are called.
 */
function defaultHeaders(
  ep: EndpointSpec,
  scheme: AuthSchemeType,
): PostmanHeader[] {
  const headers: PostmanHeader[] = [
    { key: "Accept", value: "application/json", type: "text" },
  ];
  if (isEndpointAuthNone(ep.auth)) return headers;
  if (scheme === "bearer") {
    headers.push({ key: "Authorization", value: "Bearer {{token}}", type: "text" });
  }
  return headers;
}

/**
 * `true` when the endpoint explicitly declares no auth.
 *
 * Implements the `kind: "none"` branch of the `IEndpointAuth` union.
 * The `kind` discriminator is checked first so adding a future
 * `kind: "scheme"` with extra fields does not break this function.
 */
function isEndpointAuthNone(auth: IEndpointAuth | undefined): boolean {
  return auth !== undefined && auth.kind === "none";
}

function descriptionFieldsFor(ep: EndpointSpec): EndpointSpec["fields"] {
  const bodyFields = bodyFieldsFromGraph(ep);
  if (!bodyFields) return ep.fields;

  const nonBodyFields = (ep.fields ?? []).filter((field) => field.location !== "body");
  return [...bodyFields, ...nonBodyFields];
}

function buildRequest(ep: EndpointSpec, scheme: AuthSchemeType): PostmanRequest {
  const req: PostmanRequest = {
    method: postmanMethodFor(ep.method),
    header: defaultHeaders(ep, scheme),
    url: {
      raw: "{{baseUrl}}" + ep.uri,
      host: ["{{baseUrl}}"],
      path: ep.uri.split("/").filter(Boolean),
      ...(ep.query
        ? { query: ep.query.map((q) => ({ ...q, disabled: false })) }
        : {}),
    },
    // The description documents what the endpoint accepts, with the
    // rules already extracted to build the example.
    // Audit 2026-09-06 §17, proposal r00015: when the scanner stamps
    // a `confidence: "low"` annotation on the spec, the user sees it
    // as a `**Confidence: low**` block at the top of the request
    // description — the same place they read the field table.
    description: buildRequestDescription(
      ep.description,
      descriptionFieldsFor(ep),
      // Only forward `medium` / `low`. `high` is the default and
      // would otherwise pad every collection with a redundant block.
      ep.confidence?.level === "high"
        ? undefined
        : ep.confidence,
    ),
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

function ep(spec: EndpointSpec, scheme: AuthSchemeType): PostmanItem {
  return {
    name: spec.name,
    request: buildRequest(spec, scheme),
    // Assertions are included on every request: a collection that only
    // carries URLs pushes the verification work onto whoever hits Send.
    event: [buildTestScript(spec)],
  };
}

function folder(
  name: string,
  items: PostmanItem[],
  description = "",
): PostmanItem {
  return { name, description, item: items };
}

/**
 * Logical folder an endpoint belongs to. If the spec carries `folder`
 * it is used as-is; otherwise it is derived from the URI.
 */
function folderKeyFor(
  ep: EndpointSpec,
  uriGroupOverrides: Record<string, string>,
): string {
  if (ep.folder) return ep.folder;
  return topGroupFor(ep.uri, uriGroupOverrides);
}

/**
 * Display name of a folder. If the key comes from `topGroupFor()` we
 * apply `prettyGroupName()`; if it comes from an explicit `folder`
 * we keep it verbatim.
 */
function folderNameFor(key: string, isExplicit: boolean): string {
  return isExplicit ? key : prettyGroupName(key);
}

// ---------------------------------------------------------------------------
// Grouping and collection construction
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
 * (each one belongs to a different "Erp" and "Products" root).
 */
function groupByFolder(
  specs: EndpointSpec[],
  uriGroupOverrides: Record<string, string>,
  scheme: AuthSchemeType,
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
    g.items.push(ep(spec, scheme));
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

  const order: string[] = [];
  const map = new Map<string, HierarchicalFolder>();

  for (const { g, autoMainKey } of annotated) {
    // The root folder's `mainKey` is always computed from the group's
    // URI (not from the endpoint's explicit `folder`).
    //
    // Previously it was `g.explicit ? g.key : autoMainKey`, which made
    // `g.key === mainKey` trivially true when the group was explicit
    // -> the `subs` branch (explicit subfolder) was never executed.
    // With `autoMainKey` used as `mainKey` in every case, the
    // `direct` vs `subs` decision is based on whether the explicit
    // `folder:` matches the endpoint's real top -- which is the
    // legitimate use case for an explicit subfolder.
    const mainKey = autoMainKey;

    let h = map.get(mainKey);
    if (!h) {
      const mainName = prettyGroupName(mainKey);
      h = { mainKey, mainName, subs: [], direct: [] };
      map.set(mainKey, h);
      order.push(mainKey);
    }

    if (g.explicit) {
      if (g.key === mainKey) {
        // Self-referential explicit group: its `folder:` matches the
        // real top computed from the URI, so it lives in `direct`.
        h.direct.push(...g.items);
      } else {
        // Explicit group with a `folder:` different from the real top:
        // it is an explicit subfolder under `mainKey`. This branch was
        // the one the bug left dead (a00012 H-P2a / S3.a).
        h.subs.push({ key: g.key, name: g.name, items: g.items });
      }
    } else {
      h.direct.push(...g.items);
    }
  }

  // Post-process: merge sibling folders that share the same `mainName`.
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
 * Builds the Postman collection from the endpoint catalog and the
 * project configuration.
 *
 * @param specs Endpoint catalog of the project.
 * @param config Project configuration (name, variables, zones...).
 */
export function buildCollection(
  specs: EndpointSpec[],
  config: ProjectConfig,
  /**
   * API authentication scheme.
   *
   * If not passed, it is inferred from the endpoints themselves. The
   * parameter exists so the pipeline -- which is the only one who
   * knows whether there is a login flow -- can refine it.
   */
  authScheme?: IDetectedAuthScheme,
): PostmanCollection {
  const overrides = config.uriGroupOverrides ?? {};
  // Without an explicit scheme we infer it from the endpoints.
  // `hasLoginFlow` is false because from here we cannot see it: whoever
  // knows it passes it in already resolved.
  const scheme = authScheme ?? detectAuthScheme(specs, false);
  const auth = toPostmanAuth(scheme);
  const groups = groupByFolder(specs, overrides, scheme.type);
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
      // Deterministic per project: Postman uses this id to decide
      // whether an import updates the collection or creates a new one.
      // A random UUID would leave a new copy on every regeneration
      // (p00014).
      _postman_id: collectionIdFor({
        explicitId: config.collectionId,
        collectionName: config.collectionName,
        projectName: config.name,
      }),
    },
    // The `auth` block is derived from what the API actually does, not
    // a constant.
    //
    // It used to be hardcoded to `bearer`, so an X-API-Key API would
    // receive a bearer with a `{{token}}` nobody fills in, and so would
    // an API with NO authentication. With `none` we emit nothing: if
    // we emitted an empty block, Postman would send an unresolved
    // `Authorization` header on every request and the API would answer
    // 401 for a reason that has nothing to do with what was being
    // tested.
    ...(auth ? { auth } : {}),
    variable: config.variables,
    item: authFirst(topFolders),
  };
}

/** Folder names that group the session cycle. */
const AUTH_FOLDER_NAMES = new Set([
  "auth",
  "authentication",
  "autenticacion",
  "login",
  "sesion",
  "session",
]);

/**
 * Moves the authentication folder to the top of the collection.
 *
 * It is the first place the user has to go after importing: without
 * running login first, no other endpoint responds. Leaving it in
 * alphabetical order hides it in the middle of the list.
 */
function authFirst(folders: PostmanItem[]): PostmanItem[] {
  const isAuth = (f: PostmanItem): boolean =>
    AUTH_FOLDER_NAMES.has(
      f.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""),
    );
  const auth = folders.filter(isAuth);
  if (auth.length === 0) return folders;
  return [...auth, ...folders.filter((f) => !isAuth(f))];
}
