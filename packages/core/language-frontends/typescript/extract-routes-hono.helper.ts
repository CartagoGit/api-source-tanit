/**
 * Hono route extractor (audit 2026-09-06 §12, proposal
 * `r00013` S2).
 *
 * Consumes the LanguageIR (`IRouteCallExpression[]`) and
 * emits `IExtractedRoute[]` describing every Hono route the
 * file declares. Receiver resolution uses
 * `IImportBinding` — aliases (`import { Hono as Tanit }
 * from 'hono'`) work without extra plumbing.
 *
 * Supports:
 *   1. `app.get/post/put/delete/patch/options/head/all(path, h)` — short form.
 *   2. `app.route('/api', subApp)` — cross-file mount,
 *      emitted as `IRouterMount` for `r00014` to resolve.
 *
 * Today the call collector emits a flattened IR where each
 * `.get(...).post(...)` chain returns ONE
 * `IRouteCallExpression` with `callee === "app.get"` and
 * another with `callee === "app.post"`. From the scanner's
 * point of view they are independent — chain idempotence
 * lands in the bridge layer (the same `propagateConstants`
 * that makes `app.get` and `app.post` siblings today is
 * exactly what the chain semantics already gives us).
 */
import type {
  IImportBinding,
  IRouteCallExpression,
} from "../../../contracts/interfaces/core/language-ir.interface.js";
import type {
  IExtractedRoute,
  IRouterMount,
} from "./extract-routes-fastify.helper.js";

const HTTP_VERBS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "all",
] as const;

function buildHonoReceiverSet(
  bindings: ReadonlyArray<IImportBinding>,
): Set<string> {
  const set = new Set<string>();
  for (const b of bindings) {
    const from = b.source ?? "";
    if (/hono/.test(from) && b.importedName !== "*") {
      set.add(b.name);
    }
  }
  return set;
}

/**
 * Extrae las rutas Hono del IR de un fichero ya parseado.
 *
 * Reconoce `app.get/post/...('/path', h)`, `app.all('/path', h)`
 * (emite `method: "ALL"`) y los mounts `app.route('/prefix', sub)`,
 * resolviendo el receiver solo contra routers Hono importados
 * (`hono`, `@hono/*`), no contra cualquier identificador. Un solo
 * pase sobre `calls` — el AST ya lo produjo el frontend; aquí solo se
 * interpreta.
 *
 * @param calls - Route calls del LanguageIR (propagadas y resueltas).
 * @param bindings - Import bindings del mismo fichero (filtra receivers).
 * @param file - Ruta del fichero fuente, para anclar cada ruta.
 * @returns Rutas extraídas y mounts con prefijo, en orden de aparición.
 */
export function extractHonoRoutesFromIR(
  calls: ReadonlyArray<IRouteCallExpression>,
  bindings: ReadonlyArray<IImportBinding>,
  file: string,
): {
  routes: IExtractedRoute[];
  mounts: IRouterMount[];
} {
  const honoReceivers = buildHonoReceiverSet(bindings);
  const routes: IExtractedRoute[] = [];
  const mounts: IRouterMount[] = [];

  for (const call of calls) {
    const recv = call.receiver ?? "";
    if (!honoReceivers.has(recv)) continue;
    const method = call.method?.toLowerCase() ?? "";
    const args = call.args ?? [];

    // `.route('/api', subApp)` mount
    if (method === "route") {
      const pathArg = args[0];
      const sub = args[1];
      if (
        !pathArg ||
        pathArg.kind !== "string" ||
        !sub
      )
        continue;
      mounts.push({
        plugin:
          sub.kind === "identifier"
            ? (sub as { identifierName?: string }).identifierName ?? ""
            : "",
        prefix: pathArg.value as string,
        range: { file, start: 0, end: 0 },
      });
      continue;
    }

    if (!(HTTP_VERBS as readonly string[]).includes(method)) continue;
    const pathArg = args[0];
    if (!pathArg || pathArg.kind !== "string") continue;
    const path = pathArg.value as string;
    const handler = args[1] && (args[1] as { kind: string }).kind === "identifier"
      ? (args[1] as { kind: "identifier"; identifierName?: string }).identifierName
      : undefined;
    routes.push({
      method: method.toUpperCase(),
      path,
      handler,
      range: { file, start: 0, end: 0 },
      isApp: true,
      receiver: recv,
    });
  }
  return { routes, mounts };
}
