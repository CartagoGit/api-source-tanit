/**
 * `TrpcScanner` — routers de tRPC.
 *
 * tRPC parece que no tiene rutas porque desde el cliente se llama como
 * si fueran funciones. Pero por debajo **es HTTP**, y con reglas fijas:
 *
 *   - Un `query` es un `GET /trpc/<ruta.del.procedimiento>` con la
 *     entrada en `?input=<json>`.
 *   - Un `mutation` es un `POST /trpc/<ruta>` con la entrada en el body.
 *
 * O sea que se puede generar una colección que **funciona**, que es
 * justo lo que no se puede hacer a mano sin saberse esas reglas de
 * memoria. Es lo que más valor tiene de este scanner: tRPC es el
 * protocolo del lote que más gente usa sin saber qué URL está llamando.
 *
 * El nombre del procedimiento sale de anidar los routers:
 * `appRouter → users → list` es `users.list`.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";
import { collectFilesFrom, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { findClosingParen, stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import type { ITrpcProcedure } from "../../contracts/interfaces/frameworks/scanners.interface.js";

/** El prefijo con el que se monta tRPC casi siempre. */
const DEFAULT_PREFIX = "/trpc";

const TRPC_PACKAGES = ["@trpc/server", "@trpc/client", "@trpc/next"];

/**
 * Lockfiles presentes en `projectRoot` como señales bonus de runtime.
 *
 * f00011 S4: `pnpm-lock.yaml` y `bun.lockb` afinan la confianza del
 * detector sin ser detección. Pesos pequeños: +0.1 (pnpm), +0.15
 * (bun). El detector de tRPC casi siempre llega a 0.95 por la
 * dependencia; el bonus aparece en `evidence` aunque no cambie el
 * score visible — exactamente lo que se busca: trazabilidad, no
 * detección.
 */
function lockfileSignals(projectRoot: string): Array<{ signal: string; weight: number; artifact: string }> {
  const out: Array<{ signal: string; weight: number; artifact: string }> = [];
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    out.push({ signal: "pnpm-lock.yaml presente", weight: 0.1, artifact: "pnpm-lock.yaml" });
  }
  if (existsSync(join(projectRoot, "bun.lockb"))) {
    out.push({ signal: "bun.lockb presente", weight: 0.15, artifact: "bun.lockb" });
  }
  return out;
}

export class TrpcProjectScanner implements IProjectScanner {
  readonly framework = "trpc" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const pkgPath = join(projectRoot, "package.json");
    if (!existsSync(pkgPath)) return emptyResult(0);
    const parsed = parseJson(await readFile(pkgPath, "utf8"));
    if (!parsed.ok || !isRecord(parsed.value)) return emptyResult(0);
    const deps = {
      ...((parsed.value["dependencies"] as Record<string, string>) ?? {}),
      ...((parsed.value["devDependencies"] as Record<string, string>) ?? {}),
    };
    const matched = TRPC_PACKAGES.filter((name) => deps[name]);
    if (matched.length === 0) return emptyResult(0);
    const evidence = matched.map((name) => ({
      signal: `package.json declara ${name}`,
      weight: 0.95 / matched.length,
      artifact: "package.json",
    }));
    // f00011 S4: lockfile como bonus de runtime. Sumamos al final
    // para que no pueda tapar una ausencia de framework.
    const locks = lockfileSignals(projectRoot);
    evidence.push(...locks);
    const lockBonus = locks.reduce((a, e) => a + e.weight, 0);
    return withEvidence(0.95 + lockBonus, evidence);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    return { framework: "trpc", projectRoot, artifacts: ["package.json"] };
  }
}

/** `router({ … })` y `t.router({ … })`. */
const ROUTER_RE = /(?:^|[\s=({,])(?:t\s*\.\s*)?router\s*\(/g;

/** `const usersRouter = t.router(` → nombre y posición del paréntesis. */
const NAMED_ROUTER_RE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:t\s*\.\s*)?router\s*\(/g;

/** Índice de los routers declarados con nombre en un fuente. */
export function findNamedRouters(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const own = new RegExp(NAMED_ROUTER_RE.source, NAMED_ROUTER_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = own.exec(source)) !== null) {
    const name = match[1];
    if (name) out.set(name, match.index + match[0].length - 1);
  }
  return out;
}

/**
 * Los nombres de router que aparecen **como valor** dentro de otro.
 *
 * Es lo que separa una raíz de una rama: `users: usersRouter` hace que
 * `usersRouter` sea una rama, y lo que no aparezca en ninguna es la
 * raíz del árbol.
 */
export function referencedRouterNames(
  source: string,
  namedRouters: ReadonlyMap<string, number>,
): Set<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(/(\w+)\s*:\s*([A-Za-z_$][\w$]*)\s*(?:,|\})/g)) {
    const value = match[2];
    if (value && namedRouters.has(value)) out.add(value);
  }
  return out;
}

/**
 * Lee un `router({ … })` y devuelve sus procedimientos, entrando en los
 * routers anidados.
 *
 * Se recorre carácter a carácter en vez de con un regex porque la
 * estructura es recursiva: un router contiene routers, y eso un patrón
 * plano no lo distingue.
 */
export function parseRouterObject(
  source: string,
  from = 0,
  prefix = "",
  /**
   * Routers declarados aparte, por nombre.
   *
   * Casi nadie escribe el árbol entero en una sola expresión: lo normal
   * es `const usersRouter = t.router({…})` y luego
   * `t.router({ users: usersRouter })`. Sin resolver esa indirección, los
   * procedimientos salen **sin su prefijo** —`list` en vez de
   * `users.list`— y encima el `list` de un router pisa al del otro,
   * porque desde fuera parecen el mismo.
   */
  namedRouters: ReadonlyMap<string, number> = new Map(),
  /** Nombres ya visitados, para que una referencia circular no cuelgue. */
  visiting: ReadonlySet<string> = new Set(),
): ITrpcProcedure[] {
  const open = source.indexOf("{", from);
  if (open === -1) return [];
  const close = matchingBrace(source, open);
  if (close === -1) return [];

  const out: ITrpcProcedure[] = [];
  const body = source.slice(open + 1, close);

  // Cada clave del objeto es un procedimiento o un router anidado.
  const keyRe = /(\w+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(body)) !== null) {
    const key = match[1] ?? "";
    // Solo las claves de primer nivel: las de dentro las ve la llamada
    // recursiva con su propio prefijo.
    if (depthAt(body, match.index) !== 0) continue;

    const rest = body.slice(match.index + match[0].length);
    const full = prefix ? `${prefix}.${key}` : key;

    // Router escrito en el sitio: `users: t.router({ … })`.
    const nested = /^\s*(?:t\s*\.\s*)?router\s*\(/.exec(rest);
    if (nested) {
      out.push(...parseRouterObject(rest, nested[0].length - 1, full, namedRouters, visiting));
      continue;
    }

    // Router por referencia: `users: usersRouter`.
    const reference = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|\}|$)/.exec(rest)?.[1];
    if (reference && namedRouters.has(reference) && !visiting.has(reference)) {
      out.push(
        ...parseRouterObject(
          source,
          namedRouters.get(reference)!,
          full,
          namedRouters,
          new Set([...visiting, reference]),
        ),
      );
      continue;
    }

    // `.query(...)`, `.mutation(...)`, `.subscription(...)` — el primero
    // que aparezca antes de la siguiente clave de primer nivel.
    const kind = /\.\s*(query|mutation|subscription)\s*\(/.exec(
      rest.slice(0, nextTopLevelKey(rest)),
    )?.[1];
    if (kind === "query" || kind === "mutation" || kind === "subscription") {
      out.push({ path: full, kind });
    }
  }
  return out;
}

/** El `}` que cierra el `{` de `open`. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Profundidad de llaves y paréntesis en una posición. */
function depthAt(text: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    const c = text[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
  }
  return depth;
}

/** Dónde empieza la siguiente clave de primer nivel, o el final. */
function nextTopLevelKey(text: string): number {
  const re = /(\w+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (depthAt(text, match.index) === 0 && match.index > 0) return match.index;
  }
  return text.length;
}

export class TrpcRouteScanner implements IRouteScanner {
  readonly framework = "trpc" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "trpc";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const files = await collectFilesFrom(
      ["src", "server", "app", ""].map((d) => (d ? join(match.projectRoot, d) : match.projectRoot)),
      isSourceJsTsFile,
    );

    const routes: ParsedRoute[] = [];
    const seen = new Set<string>();

    for await (const { path, text: raw } of readFilesInOrder(files)) {
      if (!/@trpc\/server|\brouter\s*\(/.test(raw)) continue;
      const source = stripJsComments(raw);
      const sourceFile = relative(match.projectRoot, path);

      const namedRouters = findNamedRouters(source);
      // Una raíz no es "el router sin nombre" — `appRouter` también
      // tiene uno. Es el que **nadie referencia**: `usersRouter` aparece
      // dentro de `appRouter`, y `appRouter` no aparece dentro de nadie.
      //
      // Entrar también por los referenciados sacaría cada procedimiento
      // dos veces: una con su prefijo (`users.list`) y otra sin él
      // (`list`), y la segunda es una ruta que no existe.
      const referenced = referencedRouterNames(source, namedRouters);
      const skip = new Set(
        [...namedRouters].filter(([name]) => referenced.has(name)).map(([, at]) => at),
      );
      const own = new RegExp(ROUTER_RE.source, ROUTER_RE.flags);
      let match2: RegExpExecArray | null;
      while ((match2 = own.exec(source)) !== null) {
        const parenAt = source.indexOf("(", match2.index);
        if (parenAt === -1) continue;
        if (skip.has(parenAt)) continue;
        if (findClosingParen(source, parenAt) === -1) continue;

        for (const proc of parseRouterObject(source, parenAt, "", namedRouters)) {
          if (seen.has(proc.path)) continue;
          seen.add(proc.path);

          // Las suscripciones van por WebSocket: una petición HTTP al
          // endpoint no funciona, y emitirla sería entregar algo que
          // falla al primer Send.
          if (proc.kind === "subscription") continue;

          const isQuery = proc.kind === "query";
          routes.push({
            // La regla de tRPC sobre HTTP: query → GET, mutation → POST.
            method: isQuery ? "GET" : "POST",
            uri: `${DEFAULT_PREFIX}/${proc.path}`,
            rawUri: `${DEFAULT_PREFIX}/${proc.path}`,
            sourceFile,
            lineNumber: 1,
            prefixChain: [DEFAULT_PREFIX],
            displayName: proc.path,
            description: `${proc.kind} \`${proc.path}\``,
            tags: [isQuery ? "Queries" : "Mutations"],
            // La entrada viaja distinto según el tipo: en la query va
            // como `?input=<json>` y en la mutación como cuerpo. Se deja
            // el sobre vacío listo, que es lo que no se sabe de memoria.
            ...(isQuery
              ? { }
              : { body: { } }),
          });
        }
      }
    }
    return { routes: routes };
  }
}
