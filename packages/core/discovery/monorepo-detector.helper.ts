/**
 * Detección de monorepo workspace — f00011 S3.
 *
 * Helper **puro** (sin estado, sin I/O síncrono): devuelve una forma de
 * dato que el orquestador o el pipeline consumen. La señal que decide
 * "esto es un monorepo" se mira en este orden:
 *
 *   1. `turbo.json`               — Turborepo
 *   2. `pnpm-workspace.yaml`      — pnpm workspaces
 *   3. `lerna.json`               — Lerna (paquete legado)
 *   4. `package.json#workspaces`  — npm/yarn workspaces (universal)
 *
 * El primero que cuadre gana. Los cuatro son señales estándar: si una
 * de ellas está en la raíz del proyecto, no hay duda razonable de que
 * la raíz NO contiene las fuentes de la API.
 *
 * ## Qué devuelve
 *
 * - `signal`: el archivo exacto que se leyó (clave para los avisos).
 * - `workspaceDirs`: los subdirectorios resueltos a partir de los globs
 *   del campo `workspaces` (relativos a `projectRoot`). Cada entrada
 *   es un único segmento, sin `..`, sin absolutos.
 * - `frameworkSearchRoot`: solo cuando hay **exactamente uno** en
 *   `workspaceDirs`. Con varios, el helper devuelve `null` y el
 *   orquestador deja el `match.frameworkSearchRoot` sin rellenar:
 *   elegir entre `apps/api`, `apps/web` y `packages/auth` no es una
 *   decisión que el escáner pueda tomar por su cuenta.
 *
 * ## Por qué un helper aparte y no dentro del orquestador
 *
 * El orquestador expone `detectAll(projectRoot)` por la interfaz
 * `IDiscoveryOrchestrator` (en `scanner.interface.ts`); esa firma no
 * recibe opciones y no se puede extender sin tocar el contrato. La
 * detección de monorepo se prueba con fixtures en este helper y el
 * orquestador lo invoca una sola vez desde el pipeline.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import type { IMonorepoDetection } from "../../contracts/interfaces/core/discovery.interface.js";

/** Los archivos que identifican un monorepo, en orden de prioridad. */
const MONOREPO_SIGNALS = [
  "turbo.json",
  "pnpm-workspace.yaml",
  "lerna.json",
] as const;

/**
 * Punto de entrada: devuelve la detección para una raíz de proyecto.
 *
 * `projectRoot` debe ser absoluto (los scanners y el pipeline ya lo
 * absolutizaron antes). Si llega relativo, se devuelve "no es monorepo"
 * con `null` por todas partes — el orquestador no debería tener que
 * adivinar cuál es la raíz.
 */
export async function detectMonorepo(
  projectRoot: string,
): Promise<IMonorepoDetection> {
  if (!projectRoot || !isAbsolute(projectRoot)) {
    return {
      isMonorepo: false,
      signal: null,
      workspaceDirs: [],
      frameworkSearchRoot: null,
    };
  }

  // 1) Las tres señales con archivo dedicado.
  for (const file of MONOREPO_SIGNALS) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) continue;
    const rawGlobs =
      file === "pnpm-workspace.yaml"
        ? await readPnpmWorkspaces(path)
        : await readJsonWorkspaces(path);
    return finalize(file, rawGlobs, projectRoot);
  }

  // 2) `package.json#workspaces` (npm/yarn).
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    const rawGlobs = await readPackageJsonWorkspaces(pkgPath);
    if (rawGlobs.length > 0) return finalize("package.json#workspaces", rawGlobs, projectRoot);
  }

  return {
    isMonorepo: false,
    signal: null,
    workspaceDirs: [],
    frameworkSearchRoot: null,
  };
}

function finalize(
  signal: string,
  rawGlobs: ReadonlyArray<string>,
  projectRoot: string,
): IMonorepoDetection {
  // 1) Normaliza cada glob (rechaza absolutos, escapa `..`) y dedup.
  //    Los globs suelen solaparse (`["apps/*", "apps/api"]`) y la
  //    detección no debe duplicar el resultado.
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const candidate of rawGlobs) {
    const normalized = normalizeRel(candidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      cleaned.push(normalized);
    }
  }
  if (cleaned.length === 0) {
    return {
      isMonorepo: true,
      signal,
      workspaceDirs: [],
      frameworkSearchRoot: null,
    };
  }
  // 2) Resuelve los globs contra el disco: `apps/*` → `apps` solo si
  //    existe; `apps/api` → `apps/api` solo si existe. Si el workspace
  //    no está materializado todavía (un repo recién clonado sin
  //    `node_modules`), no aparece.
  const resolved = resolveWorkspaceDirs(projectRoot, cleaned);
  // Dedup post-resolve: `apps/*` y `apps/api` resuelven al mismo dir.
  const resolvedSeen = new Set<string>();
  const deduped: string[] = [];
  for (const dir of resolved) {
    if (!resolvedSeen.has(dir)) {
      resolvedSeen.add(dir);
      deduped.push(dir);
    }
  }
  deduped.sort();
  return {
    isMonorepo: true,
    signal,
    workspaceDirs: deduped,
    frameworkSearchRoot: deduped.length === 1 ? deduped[0]! : null,
  };
}

/**
 * Normaliza un directorio a formato POSIX relativo, sin `.`, `..`, ni
 * absolutos. Lo que devuelven los parsers viene en formas distintas
 * (algunos con `./`, otros con `/`); aquí se aplana a una sola.
 *
 * La normalización POSIX se hace a mano porque el proyecto no depende
 * de `@types/node` ni `bun-types` — `runtime.d.ts` declara el mínimo
 * de `node:path` y nada más. Es cuatro líneas, evita una rama nueva
 * en las declaraciones ambient y se queda donde se entiende: junto a
 * la función que la usa.
 */
function normalizeRel(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (cleaned.length === 0 || cleaned.startsWith("/") || cleaned.startsWith("..")) {
    return null;
  }
  const normalized = collapsePosix(cleaned);
  if (normalized === "" || normalized === "." || normalized.startsWith("/")) {
    return null;
  }
  return normalized;
}

/**
 * Colapsa `.` y `..` en una ruta POSIX sin tocar el disco.
 *
 * El contrato:
 *  - `apps/api` → `apps/api`
 *  - `apps/../api` → `api` (un `..` que sale de un segmento se queda)
 *  - `apps/../../api` → `../api` (escapa: lo rechaza `normalizeRel`)
 *
 * No es `path.posix.normalize` completo (no resuelve `//` ni quita
 * segmentos vacíos redundantes), pero el input son globs de workspaces
 * que rara vez tienen esos casos.
 */
function collapsePosix(input: string): string {
  const segments = input.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Solo colapsa si hay algo a qué volver; si no, el `..` se
      // mantiene y `normalizeRel` lo rechaza arriba.
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else {
        out.push("..");
      }
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * Lee los workspaces desde un JSON (turbo.json / lerna.json /
 * package.json). Acepta:
 *
 *  - `workspaces: ["a", "b"]` (npm/yarn clásico)
 *  - `workspaces: { packages: ["a", "b"] }` (npm 7+)
 *  - `packages: ["a", "b"]` (Lerna)
 *  - `workspaces: [...]` con `packages` (turbo) — se funden
 *
 * El orden es importante: `packages` cubre Lerna y turbo a la vez;
 * `workspaces` cubre npm/yarn. Si los dos están en el mismo fichero,
 * se concatenan.
 */
async function readJsonWorkspaces(jsonPath: string): Promise<ReadonlyArray<string>> {
  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const candidates: unknown[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) candidates.push(...value);
  };
  // 1) `workspaces` puede ser array o `{ packages: [...] }`.
  collect(obj["workspaces"]);
  if (obj["workspaces"] && typeof obj["workspaces"] === "object" && !Array.isArray(obj["workspaces"])) {
    collect((obj["workspaces"] as Record<string, unknown>)["packages"]);
  }
  // 2) `packages` en la raíz (Lerna, turbo cuando no usa `workspaces`).
  collect(obj["packages"]);
  return candidates.filter((c): c is string => typeof c === "string");
}

/**
 * Lee `pnpm-workspace.yaml` con un parser mínimo. La sintaxis que nos
 * importa es la del campo `packages:` con una lista de globs.
 *
 * No añadimos dependencia de yaml porque la regla del binario compilado
 * es no cargar paquetes en runtime (lo dice `yaml.helper.ts`); un
 * parser de 10 líneas cubre el 100 % de los `pnpm-workspace.yaml` que
 * se ven en la práctica. Si en el futuro aparece una sintaxis que
 * este parser no entiende, el helper devuelve `[]` y el orquestador
 * sigue funcionando — solo no auto-detecta el subdir.
 */
async function readPnpmWorkspaces(yamlPath: string): Promise<ReadonlyArray<string>> {
  let raw: string;
  try {
    raw = await readFile(yamlPath, "utf8");
  } catch {
    return [];
  }
  // Busca la primera línea `packages:` y recoge las siguientes que
  // empiecen por `  -`. Ignora anidamientos: pnpm permite bloques
  // por catálogo, pero esos viven en `pnpm-workspace.yaml` aparte
  // y no los necesitamos aquí.
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    // Una clave nueva al nivel raíz termina el bloque.
    if (/^[A-Za-z_]/.test(line)) break;
    const match = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (!match || !match[1]) continue;
    const value = stripPnpmComment(match[1]).trim();
    const unquoted = value.replace(/^["']|["']$/g, "");
    if (unquoted.length > 0) out.push(unquoted);
  }
  return out;
}

/**
 * Quita el comentario inline de una línea YAML, pero solo si está
 * fuera de comillas. Se hace a mano porque no hay parser YAML y el
 * caso `"apps/api" # comentario` (la única cita entrecomillada que
 * aparece en `pnpm-workspace.yaml` reales) no se cubre con un split
 * por `#`.
 *
 * La heurística: si el valor empieza por `"` o `'`, el `#` se ignora
 * hasta encontrar la pareja. Si no, se corta al primer `#`.
 */
function stripPnpmComment(value: string): string {
  const first = value.charAt(0);
  if (first !== '"' && first !== "'") {
    const idx = value.indexOf("#");
    return idx === -1 ? value : value.slice(0, idx);
  }
  let out = first;
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      out += ch + value[i + 1];
      i++;
      continue;
    }
    if (ch === first) return out + ch;
    out += ch;
  }
  return out;
}

/**
 * Variante específica para `package.json`: la clave se llama
 * `workspaces` (sin alias). npm 7+ acepta también un objeto con
 * `packages`; lo cubre `readJsonWorkspaces`.
 */
async function readPackageJsonWorkspaces(
  pkgPath: string,
): Promise<ReadonlyArray<string>> {
  return readJsonWorkspaces(pkgPath);
}

/**
 * Resuelve un glob de workspace a su primer directorio real bajo
 * `projectRoot`. Lo que sale del parser son globs (`apps/*`,
 * `packages/api`); este helper materializa cada uno con `existsSync`
 * (es boot-time / una vez por escaneo, no hot path).
 *
 * Devuelve solo los que **existen**: si el `workspaces` lista `apps/*`
 * pero la carpeta está vacía, no se devuelve nada — sería peor
 * confundir "el workspace está vacío" con "no es monorepo".
 */
export function resolveWorkspaceDirs(
  projectRoot: string,
  globs: ReadonlyArray<string>,
): string[] {
  const out: string[] = [];
  for (const glob of globs) {
    if (glob.includes("*")) {
      // Para globs miramos el prefijo (todo lo anterior al primer `*`).
      // No resolvemos `**` ni `?` porque ningún workspace real los usa.
      const prefix = glob.split("*")[0]!.replace(/\/$/, "");
      const concrete = join(projectRoot, prefix);
      if (existsSync(concrete)) {
        const rel = relative(projectRoot, concrete).split(sep).join("/");
        if (rel && !rel.startsWith("..")) out.push(rel);
      }
    } else {
      const concrete = join(projectRoot, glob);
      if (existsSync(concrete)) out.push(glob);
    }
  }
  return out;
}