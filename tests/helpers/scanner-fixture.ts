/**
 * Construcción de proyectos temporales para los tests de scanner.
 *
 * Antes cada spec montaba su árbol a mano con `mkdtemp` + `mkdir` +
 * `copyFile` línea a línea. Además de repetirse, era frágil: en
 * `laravel-scanner.spec.ts` un `mkdir(join(dir, "artisan"))` creaba
 * `artisan` como DIRECTORIO y el `writeFile` posterior reventaba con
 * EISDIR.
 *
 * Aquí un proyecto se declara como un mapa `ruta relativa → contenido` y
 * los directorios intermedios se crean solos.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { FrameworkId, IProjectMatch } from "../../contracts/scanner.interface";
import { scannerBundleFor } from "../../frameworks/registry";
import { moduleDir } from "../../helpers/module-path.helper";

export const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "../..");

/** Proyecto temporal en disco, con su limpieza. */
export interface ITempProject {
  /** Raíz absoluta del proyecto. */
  readonly root: string;
  /** Borra el árbol. Llamar siempre en `afterAll`/`finally`. */
  cleanup(): Promise<void>;
}

/**
 * Monta un proyecto temporal a partir de un mapa ruta→contenido.
 *
 * Un fichero vacío se declara con `""`; los directorios intermedios se
 * crean automáticamente, así que no hace falta listarlos.
 *
 * ```ts
 * const project = await createTempProject({
 *   "artisan": "",
 *   "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
 *   "routes/api.php": "<?php Route::get('/health', fn () => 1);",
 * });
 * ```
 */
export async function createTempProject(
  files: Record<string, string>,
  prefix = "postman-fixture-",
): Promise<ITempProject> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Raíz del fixture "comprehensive" de un framework. */
export function comprehensiveFixture(framework: FrameworkId): string {
  return join(PACKAGE_ROOT, "tests", "fixtures", `${framework}-comprehensive`);
}

/** Raíz del mini-fixture de smoke de un framework. */
export function smokeFixture(framework: FrameworkId): string {
  return join(PACKAGE_ROOT, "tests", "smoke-fixtures", `${framework}-mini`);
}

/**
 * `IProjectMatch` de un framework sobre una raíz, usando el detector
 * registrado. Evita construir el match a mano en cada spec, que es donde
 * se colaban `artifacts: []` y otros campos inconsistentes con lo que
 * produce el detector real.
 */
export async function matchFor(
  framework: FrameworkId,
  projectRoot: string,
): Promise<IProjectMatch> {
  const bundle = scannerBundleFor(framework);
  if (!bundle) throw new Error(`framework "${framework}" no está en el scanner registry`);
  return bundle.projectScanner.resolve(projectRoot);
}

/**
 * Escanea una raíz con el scanner registrado del framework y devuelve
 * las rutas junto al match usado.
 */
export async function scanProject(
  framework: FrameworkId,
  projectRoot: string,
): Promise<{ match: IProjectMatch; routes: ReadonlyArray<import("../../contracts/scanner.interface").ParsedRoute> }> {
  const bundle = scannerBundleFor(framework);
  if (!bundle) throw new Error(`framework "${framework}" no está en el scanner registry`);
  const match = await bundle.projectScanner.resolve(projectRoot);
  return { match, routes: await bundle.routeScanner.scan(match) };
}
