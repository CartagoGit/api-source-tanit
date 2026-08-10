/**
 * Servicio de parsing de rutas Laravel.
 *
 * Lee `routes/*.php` línea a línea manteniendo una pila de prefijos
 * activos (Route::prefix('xxx')->group(...)). Ignora líneas comentadas
 * para no contar rutas comentadas como el `batches` index antiguo.
 *
 * Para los archivos cuyo prefijo se aplica externamente (cargados con
 * `Route::prefix('api/<x>')` en su ServiceProvider) se pasa un prefijo
 * inicial explícito vía FILE_PREFIXES. Esto cubre el caso típico de
 * proyectos Laravel con varios `mapXxxRoutes()` que añaden prefijos
 * distintos según el archivo.
 *
 * Devuelve cada ruta con:
 *   - `uri`: URI completa con prefijo resuelto.
 *   - `prefixChain`: lista de prefijos activos cuando se declaró la ruta.
 *
 * También exporta helpers para calcular el grupo top-level
 * (`topGroupFor`) y un nombre legible (`prettyGroupName`) a partir de la
 * URI. Esto permite generar carpetas automáticamente sin hardcodear.
 */
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { fromProjectRoot, projectDirs } from "../../core/discovery/project-context.service.js";
import { readFile } from "node:fs/promises";
import { fromProjectRelative, routesDir } from "../../core/discovery/paths.service.js";
import type { ParsedRoute } from "../../contracts/interfaces/frameworks/scanners.interface.js";

const ROUTE_METHOD_RE = /Route::(get|post|put|delete|patch)\s*\(\s*['"]([^'"]*)['"]/i;
const PREFIX_RE = /Route::prefix\(\s*['"]([^'"]+)['"]/;
/** Captura `[FooController::class, 'action']` o `[FooController::class,"action"]`. */
const ACTION_RE =
  /\[\s*([A-Za-z0-9_]+)::class\s*,\s*['"]([A-Za-z0-9_]+)['"]\s*\]/;
/** `use App\Http\Controllers\Foo\Bar as Alias;` */
const USE_RE =
  /use\s+([A-Za-z0-9_\\]+)\s*(?:as\s+([A-Za-z0-9_]+))?\s*;/g;

/** Elimina comentarios de una y varias líneas para que no se cuenten rutas comentadas. */
export function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return out;
}

/** Parsea un archivo de rutas Laravel y devuelve las rutas descubiertas. */
/**
 * `context` es opcional por compatibilidad: sin él se cae al singleton de
 * `paths.service`, que resuelve la raíz una vez por proceso. Pásalo desde
 * código nuevo (p00017).
 */
export async function parseRoutesFile(
  relPath: string,
  initialPrefix: string[] = [],
  context?: IProjectContext,
): Promise<ParsedRoute[]> {
  const abs = context ? fromProjectRoot(context, relPath) : fromProjectRelative(relPath);
  const raw = await readFile(abs, "utf8");
  const text = stripComments(raw);

  // Mapa alias → FQCN a partir de los `use` del archivo.
  const imports = new Map<string, string>();
  let um: RegExpExecArray | null;
  const useRe = ownRegex(USE_RE);
  while ((um = useRe.exec(text)) !== null) {
    const fqcn = um[1];
    if (!fqcn) continue;
    const short = fqcn.split("\\").pop() ?? fqcn;
    const alias = um[2] ?? short;
    imports.set(alias, fqcn);
    // También indexamos por el short name por si no hay alias.
    if (!imports.has(short)) imports.set(short, fqcn);
  }

  const prefixStack: string[] = [...initialPrefix];
  const out: ParsedRoute[] = [];

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Algunas rutas parten el array del controlador en la línea siguiente.
    const nextLine = lines[i + 1] ?? "";
    const window = `${line} ${nextLine}`;

    const pm = PREFIX_RE.exec(line);
    if (pm?.[1]) {
      prefixStack.push(pm[1]);
    }
    if (/\}\s*\)/.test(line) && prefixStack.length > initialPrefix.length) {
      prefixStack.pop();
    }
    const rm = ROUTE_METHOD_RE.exec(line);
    if (rm?.[1] !== undefined) {
      const method = rm[1].toUpperCase();
      const rawUri = rm[2] ?? "";
      const segments = rawUri ? [...prefixStack, rawUri] : [...prefixStack];
      const full = segments.join("/").replace(/\/+/g, "/");

      let controllerClass: string | undefined;
      let actionName: string | undefined;
      const am = ACTION_RE.exec(window);
      if (am?.[1] && am[2]) {
        const alias = am[1];
        actionName = am[2];
        controllerClass =
          imports.get(alias) ??
          // Fallback: asumir App\Http\Controllers\<alias>
          `App\\Http\\Controllers\\${alias}`;
      }

      out.push({
        method,
        uri: full,
        rawUri,
        sourceFile: relPath,
        lineNumber: i + 1,
        prefixChain: [...prefixStack],
        ...(controllerClass ? { controllerClass } : {}),
        ...(actionName ? { actionName } : {}),
      });
    }
  }
  return out;
}

/**
 * Parsea todos los archivos de rutas relevantes.
 *
 * @param filePrefixes Mapa archivo → prefijos externos (del `ProjectConfig`).
 *   Si un archivo no está aquí, se asume el prefijo `["api"]` por defecto.
 */
export async function parseAllRoutes(
  filePrefixes: Record<string, string[]> = {},
  context?: IProjectContext,
): Promise<ParsedRoute[]> {
  // Recorremos `routes/` directamente: cualquier archivo PHP es un
  // archivo de rutas. Si está en `filePrefixes`, usamos esos prefijos;
  // si no, asumimos el prefijo `api/` que añade Laravel por defecto
  // en `RouteServiceProvider::mapApiRoutes()`.
  const fs = await import("node:fs/promises");
  const ROUTES_DIR = context ? projectDirs(context).routes : routesDir();
  if (!ROUTES_DIR) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(ROUTES_DIR);
  } catch {
    return [];
  }
  const phpFiles = entries.filter((e) => e.endsWith(".php"));
  const out: ParsedRoute[] = [];
  for (const f of phpFiles) {
    const rel = `routes/${f}`;
    const prefixes = filePrefixes[rel] ?? ["api"];
    const parsed = await parseRoutesFile(rel, prefixes, context);
    out.push(...parsed);
  }
  return out;
}


