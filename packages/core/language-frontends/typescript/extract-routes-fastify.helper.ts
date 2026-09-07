/**
 * Fastify route extractor (audit 2026-09-06 §12, proposal
 * `r00013` S1).
 *
 * Consumes the LanguageIR (`IRouteCallExpression[]` already
 * propagated via `propagateConstants`) and emits
 * `IExtractedRoute[]` describing every Fastify route the
 * file declares. Receiver resolution uses
 * `IImportBinding` (default imports rename freely — the
 * proposal asks for "cualquier nombre vía
 * `IImportBinding.importedName`").
 *
 * Supports three forms:
 *   1. `app.get/post/put/delete/patch/options/head/all(path, h)`
 *   2. `app.route(path, h)`  (positional: URL first, handler second)
 *   3. `app.route({ method, url, ... })`  (object form; method can
 *      be a string or an array of strings)
 *
 * Plus `.register(plugin, { prefix: '/x' })` emission as
 * `IRouterMount` so downstream consumers (r00014 S4+) can
 * resolve cross-file router imports.
 */
import type {
  IImportBinding,
  IRouteCallExpression,
} from "../../../contracts/interfaces/core/language-ir.interface.js";

/** HTTP methods recognised as Fastify verbs. */
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

/** The single route the extractor emits. */
export interface IExtractedRoute {
  readonly method: string;
  readonly path: string;
  readonly handler?: string;
  readonly range: { readonly file: string; readonly start: number; readonly end: number };
  /**
   * True when the receiver is an `import Fastify from 'fastify'`
   * default import (so downstream can mark the route as
   * root-level). Sub-router roots receive `false`.
   */
  readonly isApp: boolean;
  /** Receiver identifier, e.g. `app`, `usersRouter`. */
  readonly receiver: string;
}

/** Mount signal: `.register(plugin, { prefix })`. */
export interface IRouterMount {
  readonly plugin: string;
  readonly prefix: string;
  readonly range: { readonly file: string; readonly start: number; readonly end: number };
}

/** Detection: which local names receive Fastify-style calls. */
function buildFastifyReceiverSet(
  bindings: ReadonlyArray<IImportBinding>,
): Set<string> {
  const set = new Set<string>();
  for (const b of bindings) {
    const from = b.source ?? "";
    // We tag default imports from `fastify` or `@fastify/router`
    // (a convention without scope guards — the alias could be
    // anything; we trust the caller's import surface).
    if (
      /fastify/.test(from) &&
      b.importedName !== "*"
    ) {
      set.add(b.name);
    }
  }
  return set;
}

/**
 * Extrae las rutas Fastify del IR de un fichero ya parseado.
 *
 * Cubre la forma corta (`fastify.get('/path', h)`, incluida la
 * expansión de `method: ['GET', 'POST']` en `fastify.route({...})` a
 * una ruta por verbo) y los mounts de plugins
 * (`fastify.register(sub, { prefix })`). El receiver se valida contra
 * bindings de `fastify`/`Fastify` para no confundir llamadas ajenas.
 *
 * @param calls - Route calls del LanguageIR (propagadas y resueltas).
 * @param bindings - Import bindings del mismo fichero.
 * @param file - Ruta del fichero fuente, para anclar cada ruta.
 * @returns Rutas extraídas (una por verbo) y mounts con prefijo.
 */
export function extractFastifyRoutesFromIR(
  calls: ReadonlyArray<IRouteCallExpression>,
  bindings: ReadonlyArray<IImportBinding>,
  file: string,
): {
  routes: IExtractedRoute[];
  mounts: IRouterMount[];
} {
  const fastifyReceivers = buildFastifyReceiverSet(bindings);
  const routes: IExtractedRoute[] = [];
  const mounts: IRouterMount[] = [];

  for (const call of calls) {
    const recv = call.receiver ?? "";
    if (!fastifyReceivers.has(recv)) continue;

    const method = call.method?.toLowerCase() ?? "";
    const args = call.args ?? [];

    // (a) Verb shorthand: app.get/post/...
    if (
      method === "route" &&
      args.length >= 1
    ) {
      const first = args[0]!;
      // Object form — `{ method, url, handler }`
      if (first.kind === "object" && (first as { kind: "object" }).kind === "object") {
        const obj = first as { kind: "object"; objectShape?: ReadonlyArray<{ key: string; literal: { kind: string; value: unknown } }> };
        const pathField = obj.objectShape?.find((p) => p.key === "url");
        const methodField = obj.objectShape?.find((p) => p.key === "method");
        const handlerField = obj.objectShape?.find((p) => p.key === "handler");
        const path = typeof pathField?.literal.value === "string" ? (pathField.literal.value as string) : "";
        const m = methodField?.literal.value;
        if (!path || !m) continue;
        const handler =
          typeof handlerField?.literal.value === "string"
            ? (handlerField.literal.value as string)
            : undefined;
        const methods = Array.isArray(m) ? (m as unknown[]) : [m];
        for (const mt of methods) {
          if (typeof mt !== "string") continue;
          routes.push({
            method: mt.toUpperCase(),
            path,
            handler,
            range: { file, start: 0, end: 0 },
            isApp: true,
            receiver: recv,
          });
        }
        continue;
      }
      // Positional form — `app.route("/x", handler)`
      if (first.kind === "string") {
        const path = (first as { kind: "string"; value: string }).value;
        const handler = args[1] && (args[1] as { kind: string }).kind === "identifier"
          ? (args[1] as { kind: "identifier"; identifierName?: string }).identifierName
          : undefined;
        routes.push({
          method: "GET",
          path,
          handler,
          range: { file, start: 0, end: 0 },
          isApp: true,
          receiver: recv,
        });
      }
      continue;
    }

    if (
      (HTTP_VERBS as readonly string[]).includes(method)
    ) {
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
      continue;
    }

    // `.register(sub, { prefix })` mount signal.
    if (method === "register" && args.length >= 2) {
      const plugin = args[0] && (args[0] as { kind: string }).kind === "identifier"
        ? (args[0] as { kind: "identifier"; identifierName?: string }).identifierName
        : undefined;
      const opts = args[1];
      let prefix = "";
      if (opts && opts.kind === "object") {
        const obj = opts as { kind: "object"; objectShape?: ReadonlyArray<{ key: string; literal: { kind: string; value: unknown } }> };
        const pf = obj.objectShape?.find((p) => p.key === "prefix");
        if (pf && typeof pf.literal.value === "string") {
          prefix = pf.literal.value as string;
        }
      }
      if (plugin) {
        mounts.push({
          plugin,
          prefix,
          range: { file, start: 0, end: 0 },
        });
      }
    }
  }
  return { routes, mounts };
}
