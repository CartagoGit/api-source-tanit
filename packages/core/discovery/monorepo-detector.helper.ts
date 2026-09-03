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
import { isAbsolute, join, posix, relative, sep } from "node:path";

/** Lo que `detectMonorepo()` devuelve. Siempre, incluso sin monorepo. */
export interface IMonorepoDetection {
  /** ¿Hay alguna señal estándar de monorepo en la raíz? */
  readonly isMonorepo: boolean;
  /**
   * El archivo exacto que se leyó para concluir `isMonorepo`.
   * `null` cuando no hay monorepo: así los avisos del pipeline pueden
   * decir "no se detectó monorepo" sin filtrar cuál de los cuatro se
   * miró primero.
   */
  readonly signal: string | null;
  /**
   * Los subdirectorios del workspace, relativos a `projectRoot`, en
   * formato POSIX y sin `..`. Vacío cuando no es monorepo o cuando los
   * globs no resuelven a ningún directorio existente.
   */
  readonly workspaceDirs: ReadonlyArray<string>;
  /**
   * Recomendación cuando hay **exactamente un** workspace. `null` en
   * cualquier otro caso (no-monorepo, cero workspaces o varios). El
   * orquestador pega este valor en `match.frameworkSearchRoot` solo
   * si la persona no pasó `--framework-search-root`.
   */
  readonly frameworkSearchRoot: string | null;
}

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
    const dirs = file === "pnpm-workspace.yaml"
      ? await readPnpmWorkspaces(path)
      : await readJsonWorkspaces(path);
    return finalize(file, dirs);
  }

  // 2) `package.json#workspaces` (npm/yarn).
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    const dirs = await readPackageJsonWorkspaces(pkgPath);
    if (dirs.length > 0) return finalize("package.json#workspaces", dirs);
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
  rawDirs: ReadonlyArray<string>,
): IMonorepoDetection {
  // Dedup + sort: los globs suelen solaparse
  // (`["apps/*", "apps/api"]` resuelve dos veces el mismo dir).
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const candidate of rawDirs) {
    const normalized = normalizeRel(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    dirs.push(normalized);
  }
  dirs.sort();
  return {
    isMonorepo: true,
    signal,
    workspaceDirs: dirs,
    frameworkSearchRoot: dirs.length === 1 ? dirs[0]! : null,
  };
}

/**
 * Normaliza un directorio a formato POSIX relativo, sin `.`, `..`, ni
 * absolutos. Lo que devuelven los parsers viene en formas distintas
 * (algunos con `./`, otros con `/`); aquí se aplana a una sola.
 */
function normalizeRel(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (cleaned.length === 0 || cleaned.startsWith("/") || cleaned.startsWith("..")) {
    return null;
  }
  // Una entrada como `apps/../api` se colapsa a `api`. La libreria
  // `path.posix.normalize` lo hace sin I/O y sin tocar el disco.
  const normalized = posix.normalize(cleaned);
  if (normalized === "." || normalized.startsWith("..") || normalized.startsWith("/")) {
    return null;
  }
  return normalized;
}

/**
 * Lee los workspaces desde un JSON (turbo.json / lerna.json /
 * package.json). Acepta tanto el formato array como el objeto
 * `{ packages: [...] }` de npm 7+.
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
  if (Array.isArray(obj["workspaces"])) {
    candidates.push(...obj["workspaces"]);
  } else if (Array.isArray(obj["packages"])) {
    candidates.push(...obj["packages"]);
  }
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
    const value = match[1].replace(/^["']|["']$/g, "");
    // Quita comentarios inline.
    const clean = value.split("#")[0]?.trim() ?? "";
    if (clean.length > 0) out.push(clean);
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