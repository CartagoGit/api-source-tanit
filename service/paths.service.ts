/**
 * Fachada con estado sobre `project-context.service.ts`.
 *
 * **Preferir `resolveProjectContext()` en código nuevo.** Este módulo
 * cachea la raíz una vez por proceso, lo que sirve para el CLI —un
 * proceso por proyecto— pero no para consumidores de vida larga. Existe
 * porque ocho servicios y varios scripts aún lo usan; `withProjectRoot()`
 * cubre el hueco mientras tanto (p00017).
 *
 * Descubrimiento automático de rutas (agnóstico del proyecto).
 *
 * Resuelve siempre ABSOLUTAS, sin usar `__dirname` relativo. Dos raíces:
 *   - `packageRoot()`  → carpeta donde vive este paquete.
 *   - `projectRoot()`  → raíz del proyecto Laravel (donde está `artisan`).
 *
 * Resolución del `packageRoot`:
 *   1. `import.meta.dir` (Bun/Node ESM).
 *   2. Búsqueda subiendo desde `process.cwd()` hasta dar con
 *      `package.json` + `contract/postman.constant.ts`.
 *
 * Resolución del `projectRoot`:
 *   1. CLI `--project-root <path>`.
 *   2. Env `POSTMAN_PROJECT_ROOT`.
 *   3. Subiendo desde `packageRoot()` hasta dar con `artisan` + `routes/` + `app/`.
 *
 * Directorio de output (`outputDir()`):
 *   1. CLI `--output-dir <path>` o `--output <file>` (parent).
 *   2. Env `POSTMAN_OUTPUT_DIR`.
 *   3. Si `packageRoot` está **dentro** de `projectRoot` (modo repo):
 *        → `${packageRoot}/build/`
 *      Si NO (modo paquete externo en otro proyecto):
 *        → `${projectRoot}/build/`
 *   4. `process.cwd()/build/` como último fallback.
 */
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Caché interna
// ---------------------------------------------------------------------------

interface Discovered {
  packageRoot: string;
  projectRoot: string | null;
  packageBasename: string;
  projectBasename: string;
}

let cache: Discovered | null = null;

// ---------------------------------------------------------------------------
// Helpers de búsqueda
// ---------------------------------------------------------------------------

function dirnameUp(start: string, steps: number): string {
  let cur = start;
  for (let i = 0; i < steps; i++) {
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return cur;
}

function walkUp(
  start: string,
  predicate: (dir: string) => boolean,
): string | null {
  let cur = resolve(start);
  for (let i = 0; i < 16; i++) {
    if (predicate(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

function findPackageRoot(start: string): string | null {
  return walkUp(start, (dir) => {
    return (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "contract"))
    );
  });
}

function findLaravelProjectRoot(start: string): string | null {
  return walkUp(start, (dir) => {
    return (
      existsSync(join(dir, "artisan")) &&
      existsSync(join(dir, "routes")) &&
      existsSync(join(dir, "app"))
    );
  });
}

function readProjectRootFromArgv(argv: string[]): string | null {
  const idx = argv.indexOf("--project-root");
  if (idx === -1) return null;
  return argv[idx + 1] ?? null;
}

function resolveProjectRoot(packageRoot: string): string | null {
  const cliArg = readProjectRootFromArgv(process.argv);
  if (cliArg) return resolve(cliArg);
  const env = process.env.POSTMAN_PROJECT_ROOT;
  if (env) return resolve(env);
  return findLaravelProjectRoot(packageRoot);
}

function basenameOrFallback(p: string, fallback: string): string {
  const last = p.split(sep).filter(Boolean).pop();
  return last ?? fallback;
}

function discover(): Discovered {
  if (cache) return cache;
  const start = (import.meta as { dir?: string }).dir ?? __dirname;
  const packageRoot =
    findPackageRoot(start) ?? dirnameUp(start, 1);

  const projectRoot = resolveProjectRoot(packageRoot);
  const packageBasename = basenameOrFallback(packageRoot, "postman");
  const projectBasename = projectRoot
    ? basenameOrFallback(projectRoot, packageBasename)
    : packageBasename;

  cache = {
    packageRoot,
    projectRoot,
    packageBasename,
    projectBasename,
  };
  return cache;
}

/** Limpia la caché (útil para tests). */
export function resetPathCache(): void {
  cache = null;
}

/**
 * Ejecuta `fn` con la raíz del proyecto fijada a `root`, y restaura el
 * estado anterior al terminar (también si `fn` lanza).
 *
 * El descubrimiento de rutas se resuelve **una vez por proceso** y se
 * cachea. Eso vale para el CLI —un proceso por proyecto— pero rompe a
 * cualquier consumidor de vida larga: un servidor MCP que analice el
 * proyecto A y luego el B obtenía las rutas de A. Y obligaba a los tests
 * a manosear `process.env` a mano antes y después de cada llamada.
 *
 * Este envoltorio hace reentrante todo lo que dependa del singleton sin
 * tener que enhebrar un contexto por las ocho capas de servicio. El paso
 * siguiente —`IProjectContext` explícito en cada firma— sigue pendiente
 * (p00017 S3).
 */
export async function withProjectRoot<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previousEnv = process.env["POSTMAN_PROJECT_ROOT"];
  const previousCache = cache;

  process.env["POSTMAN_PROJECT_ROOT"] = resolve(root);
  cache = null;

  try {
    return await fn();
  } finally {
    if (previousEnv === undefined) delete process.env["POSTMAN_PROJECT_ROOT"];
    else process.env["POSTMAN_PROJECT_ROOT"] = previousEnv;
    cache = previousCache;
  }
}

/** Raíz de este paquete. */
export function packageRoot(): string {
  return discover().packageRoot;
}

/** Raíz del proyecto Laravel. `null` si no se encuentra. */
export function projectRoot(): string | null {
  return discover().projectRoot;
}

/** `${projectRoot}/routes` o `null`. */
export function routesDir(): string | null {
  const r = projectRoot();
  return r ? join(r, "routes") : null;
}

/** `${projectRoot}/app` o `null`. */
export function appDir(): string | null {
  const r = projectRoot();
  return r ? join(r, "app") : null;
}

/** `${projectRoot}/app/Http/Requests` o `null`. */
export function requestsDir(): string | null {
  const a = appDir();
  return a ? join(a, "Http", "Requests") : null;
}

/** Nombre del proyecto Laravel. */
export function projectBasename(): string {
  return discover().projectBasename;
}

/** Nombre del paquete. */
export function packageBasename(): string {
  return discover().packageBasename;
}

// ---------------------------------------------------------------------------
// Directorio de OUTPUT
// ---------------------------------------------------------------------------

/**
 * Devuelve el directorio donde se escriben los artefactos.
 * Regla:
 *   1. CLI `--output-dir <path>` o `--output <file>` (parent).
 *   2. Env `POSTMAN_OUTPUT_DIR`.
 *   3. Si el paquete está **dentro** del proyecto Laravel → `${packageRoot}/build/`.
 *      Si NO → `${projectRoot}/build/`.
 *   4. `process.cwd()/build/` fallback.
 */
export function outputDir(): string {
  const d = discover();
  const argv = process.argv;

  // 1. CLI
  const odIdx = argv.indexOf("--output-dir");
  if (odIdx !== -1 && argv[odIdx + 1]) {
    return resolve(argv[odIdx + 1]);
  }
  const oIdx = argv.indexOf("--output");
  if (oIdx !== -1 && argv[oIdx + 1]) {
    return resolve(dirname(argv[oIdx + 1]));
  }

  // 2. Env
  const envDir = process.env.POSTMAN_OUTPUT_DIR;
  if (envDir) return resolve(envDir);

  // 3. Inferencia por relación packageRoot ↔ projectRoot.
  if (d.projectRoot) {
    const rel = relative(d.projectRoot, d.packageRoot);
    // Si `rel` no empieza por ".." ni es absoluto, packageRoot está DENTRO
    // del proyecto. En ese caso el output va en build/ del paquete.
    const inside = rel && !rel.startsWith("..") && !relative(d.packageRoot, d.projectRoot).startsWith("..");
    // `inside=true` solo si projectRoot ⊂ packageRoot o packageRoot ⊂ projectRoot.
    // Caso típico: packageRoot = ${projectRoot}/resources/postman, projectRoot = ${projectRoot}.
    // rel = ".." + "resources/postman" → startsWith(".."), así que outside.
    // Si está dentro: rel = "resources/postman" → inside.
    const pkgInsideProj = rel === ".." || (!rel.startsWith("..") && rel !== "");
    return pkgInsideProj
      ? join(d.packageRoot, "build")
      : join(d.projectRoot, "build");
  }

  // 4. Fallback
  return join(process.cwd(), "build");
}

/**
 * Nombre base del JSON de salida.
 * Prioridad: env `POSTMAN_OUTPUT_BASENAME` → basename del proyecto Laravel.
 */
export function outputBasename(projectName?: string): string {
  const env = process.env.POSTMAN_OUTPUT_BASENAME;
  if (env) {
    return env.endsWith(".postman_collection")
      ? env
      : `${env}.postman_collection`;
  }
  const base = projectName?.trim() || projectBasename();
  return `${base}.postman_collection`;
}

/** Ruta absoluta al JSON principal. Crea `outputDir` si no existe. */
export async function outputCollectionPath(
  projectName?: string,
): Promise<string> {
  await ensureOutputDir();
  return join(outputDir(), `${outputBasename(projectName)}.json`);
}

/** Ruta absoluta al JSON enriquecido. */
export async function outputEnrichedPath(
  projectName?: string,
): Promise<string> {
  await ensureOutputDir();
  return join(outputDir(), `${outputBasename(projectName)}.enriched.json`);
}

/** Ruta absoluta al environment Postman para un entorno dado. */
export async function outputEnvironmentPath(
  envName: string,
  projectName?: string,
): Promise<string> {
  await ensureOutputDir();
  const base = projectName?.trim() || projectBasename();
  const slug = envName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return join(outputDir(), `${base}.${slug}.postman_environment.json`);
}

async function ensureOutputDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  const dir = outputDir();
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Convierte una ruta absoluta del proyecto a una relativa al proyecto
 * (formato POSIX). Lanza si no hay raíz de proyecto conocida.
 */
export function toProjectRelative(absPath: string): string {
  const r = projectRoot();
  if (!r) {
    throw new Error(
      "No se pudo determinar la raíz del proyecto Laravel. " +
        "Define POSTMAN_PROJECT_ROOT o ejecuta con --project-root <path>.",
    );
  }
  return relative(r, absPath).split(sep).join("/");
}

export function fromProjectRelative(relPath: string): string {
  const r = projectRoot();
  if (!r) {
    throw new Error(
      "No se pudo determinar la raíz del proyecto Laravel. " +
        "Define POSTMAN_PROJECT_ROOT o ejecuta con --project-root <path>.",
    );
  }
  return join(r, relPath);
}

export function describeDiscoveredPaths(): string {
  const d = discover();
  return [
    `  · Package root:   ${d.packageRoot}`,
    `  · Project root:   ${d.projectRoot ?? "(not found)"}`,
    `  · Routes dir:     ${routesDir() ?? "(not found)"}`,
    `  · Requests dir:   ${requestsDir() ?? "(not found)"}`,
    `  · Output dir:     ${outputDir()}`,
    `  · Collection:     ${join(outputDir(), `${outputBasename()}.json`)}`,
  ].join("\n");
}