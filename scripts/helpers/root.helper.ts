/**
 * Las rutas del repo, en un solo sitio.
 *
 * Nadie vuelve a escribir `resolve(__dirname, "../../..")` ni
 * `join(root, "packages", "cli", "cli.script.ts")` a mano. Cada carpeta
 * y cada fichero conocido tiene aquí un nombre.
 *
 * El motivo no es comodidad, es que la alternativa **falla en
 * silencio**. Contar `..` acopla un fichero a su profundidad en el
 * árbol, y durante la reorganización eso mordió tres veces seguidas: al
 * mover los gates a `scripts/gates/`, al mover el plugin a `packages/`,
 * y otra vez al meterlo en `packages/plugins/`. Ninguna de las tres
 * lanzó un error — una ruta equivocada no revienta, simplemente no
 * encuentra nada, y el lint decía "no se encontró ninguna propuesta"
 * como si el repo estuviera vacío.
 *
 * Con esto, mover una carpeta rompe **un** fichero (este) en vez de
 * catorce, y `root.helper.spec.ts` comprueba que todo lo declarado
 * existe de verdad en disco: si algo se mueve y no se actualiza aquí,
 * el gate lo dice en voz alta.
 *
 * Esto es tooling del repo. El código que se publica **no** lo usa: en
 * el binario compilado no hay árbol de ficheros que recorrer, y para
 * eso está `findRepoRoot()` en `packages/core/helpers/`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Marcadores que identifican la raíz del repo.
 *
 * `package.json` a secas no vale: lo tienen también los paquetes de
 * `packages/plugins/*`, y la búsqueda pararía en el primero. Se exige
 * que estén los dos.
 */
const ROOT_MARKERS = ["package.json", "delendai.config.json"] as const;

function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 12; up++) {
    if (ROOT_MARKERS.every((marker) => existsSync(join(dir, marker)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `No se encontró la raíz del repo (${ROOT_MARKERS.join(" + ")}) subiendo desde ` +
      dirname(fileURLToPath(import.meta.url)),
  );
}

/** Raíz del repositorio, absoluta. Se resuelve una vez. */
export const REPO_ROOT = findRoot();

/** Cualquier ruta del repo, a partir de su raíz. */
export function fromRoot(...segments: readonly string[]): string {
  return join(REPO_ROOT, ...segments);
}

// ---------------------------------------------------------------------------
// El producto
// ---------------------------------------------------------------------------

/** Todo el código del producto. */
export const PACKAGES_DIR = fromRoot("packages");

/**
 * Interfaces, tipos y constantes compartidos. Sin implementación.
 *
 * La sección más nuclear: no depende de nadie y todas dependen de ella.
 * Antes esto era `packages/core/contracts/`, dentro del núcleo, y por eso
 * usarlo desde la UI o desde el plugin arrastraba el núcleo entero
 * (r00007).
 */
export const CONTRACTS_DIR = join(PACKAGES_DIR, "contracts");
export const CONTRACTS_INTERFACES_DIR = join(CONTRACTS_DIR, "interfaces");
export const CONTRACTS_CONSTANTS_DIR = join(CONTRACTS_DIR, "constants");

/** Núcleo agnóstico: no nombra ni un framework. */
export const CORE_DIR = join(PACKAGES_DIR, "core");
export const CORE_DOMAIN_DIR = join(CORE_DIR, "domain");
export const CORE_DISCOVERY_DIR = join(CORE_DIR, "discovery");
export const CORE_ADAPTERS_DIR = join(CORE_DIR, "adapters");
export const CORE_HELPERS_DIR = join(CORE_DIR, "helpers");

/** Lo concreto de cada framework. */
export const FRAMEWORKS_DIR = join(PACKAGES_DIR, "frameworks");
export const FRAMEWORKS_SCANNERS_DIR = join(FRAMEWORKS_DIR, "scanners");
export const FRAMEWORKS_PARSERS_DIR = join(FRAMEWORKS_DIR, "parsers");

/** Raíz de composición: el CLI. */
export const CLI_DIR = join(PACKAGES_DIR, "cli");
export const CLI_COMMANDS_DIR = join(CLI_DIR, "commands");
/** El dispatcher. Es el `bin` del paquete y el entrypoint del binario. */
export const CLI_ENTRYPOINT = join(CLI_DIR, "cli.script.ts");

/** Asistente interactivo. */
export const UI_DIR = join(PACKAGES_DIR, "ui");

/**
 * Integraciones opcionales con hosts externos (Delendai, etc.).
 *
 * Una integración NO es parte del producto Tanit: vive aquí por
 * conveniencia del desarrollador que quiere enganchar Tanit a un
 * host MCP, pero el CLI, el binario y la UI de Tanit funcionan
 * sin ella. Cada integración es un paquete independiente con su
 * propio `package.json` y se valida en su propio workflow
 * (`integration-delendai.yml` para la integración con Delendai).
 * x00041.
 */
export const INTEGRATIONS_DIR = fromRoot("integrations");
/** La integración con un host concreto. Hoy solo `delendai`. */
export function integrationDir(host: string): string {
  return join(INTEGRATIONS_DIR, host);
}
/**
 * La integración con Delendai.
 *
 * El plugin registra las tools con el prefijo `delendai_tanit_*`
 * (lo declara el host leyendo `plugin.name === 'tanit'`); por
 * tanto leyendo el árbol se sabe de qué host es y qué producto
 * expone.
 */
export const DELENDAI_INTEGRATION_DIR = integrationDir("delendai");

// ---------------------------------------------------------------------------
// Tooling del repo
// ---------------------------------------------------------------------------

export const SCRIPTS_DIR = fromRoot("scripts");
export const GATES_DIR = join(SCRIPTS_DIR, "gates");
export const BUILD_SCRIPTS_DIR = join(SCRIPTS_DIR, "build");
export const SCRIPT_HELPERS_DIR = join(SCRIPTS_DIR, "helpers");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export const TESTS_DIR = fromRoot("tests");
export const TEST_HELPERS_DIR = join(TESTS_DIR, "helpers");

/** Fixtures completos: la forma real de un proyecto de ese framework. */
export const FIXTURES_DIR = join(TESTS_DIR, "fixtures");
/** Fixtures mínimos: lo justo para que el detector reconozca el framework. */
export const SMOKE_FIXTURES_DIR = join(TESTS_DIR, "smoke-fixtures");

/** `tests/fixtures/<framework>-comprehensive`. */
export function comprehensiveFixtureDir(framework: string): string {
  return join(FIXTURES_DIR, `${framework}-comprehensive`);
}

/** `tests/smoke-fixtures/<framework>-mini`. */
export function smokeFixtureDir(framework: string): string {
  return join(SMOKE_FIXTURES_DIR, `${framework}-mini`);
}

// ---------------------------------------------------------------------------
// Ejemplos y documentación
// ---------------------------------------------------------------------------

export const EXAMPLES_DIR = fromRoot("examples");

/** `examples/example-<framework>`. */
export function exampleDir(framework: string): string {
  return join(EXAMPLES_DIR, `example-${framework}`);
}

export const DOCS_DIR = fromRoot("docs");
export const PROPOSALS_DIR = join(DOCS_DIR, "delendai", "proposals");

// ---------------------------------------------------------------------------
// Ficheros sueltos que se leen o escriben desde el tooling
// ---------------------------------------------------------------------------

export const PACKAGE_JSON = fromRoot("package.json");
/** Config del host delendai: qué plugins carga y desde dónde. */
export const DELENDAI_CONFIG = fromRoot("delendai.config.json");
/** Config MCP de Claude Code. Es la fuente de verdad (ver `mcp:sync`). */
export const MCP_JSON = fromRoot(".mcp.json");
export const VSCODE_DIR = fromRoot(".vscode");
/** Config MCP de VS Code. Se **genera** desde `MCP_JSON`. */
export const VSCODE_MCP_JSON = join(VSCODE_DIR, "mcp.json");
/** Binarios compilados por `build:binary`. */
export const DIST_DIR = fromRoot("dist");

/**
 * Todo lo declarado arriba que debe existir en disco.
 *
 * Lo consume `root.helper.spec.ts`. Sin esa comprobación, este fichero
 * sería otro sitio donde una ruta puede quedarse vieja en silencio — el
 * problema que viene a resolver.
 *
 * Las funciones parametrizadas (`exampleDir`, `pluginDir`…) no entran:
 * el test las ejercita con valores reales por su cuenta.
 */
export const WELL_KNOWN_PATHS: Readonly<Record<string, string>> = {
  REPO_ROOT,
  PACKAGES_DIR,
  CORE_DIR,
  CONTRACTS_DIR,
  CONTRACTS_INTERFACES_DIR,
  CONTRACTS_CONSTANTS_DIR,
  CORE_DOMAIN_DIR,
  CORE_DISCOVERY_DIR,
  CORE_ADAPTERS_DIR,
  CORE_HELPERS_DIR,
  FRAMEWORKS_DIR,
  FRAMEWORKS_SCANNERS_DIR,
  FRAMEWORKS_PARSERS_DIR,
  CLI_DIR,
  CLI_COMMANDS_DIR,
  CLI_ENTRYPOINT,
  UI_DIR,
  INTEGRATIONS_DIR,
  DELENDAI_INTEGRATION_DIR,
  SCRIPTS_DIR,
  GATES_DIR,
  BUILD_SCRIPTS_DIR,
  SCRIPT_HELPERS_DIR,
  TESTS_DIR,
  TEST_HELPERS_DIR,
  FIXTURES_DIR,
  SMOKE_FIXTURES_DIR,
  EXAMPLES_DIR,
  DOCS_DIR,
  PROPOSALS_DIR,
  PACKAGE_JSON,
  DELENDAI_CONFIG,
  MCP_JSON,
  VSCODE_DIR,
  VSCODE_MCP_JSON,
};
