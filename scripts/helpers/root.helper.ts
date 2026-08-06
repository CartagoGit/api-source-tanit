/**
 * Las rutas del repo, en un solo sitio.
 *
 * Nadie vuelve a escribir `resolve(__dirname, "../../..")` ni
 * `join(root, "projects", "cli", "cli.script.ts")` a mano. Cada carpeta
 * y cada fichero conocido tiene aquí un nombre.
 *
 * El motivo no es comodidad, es que la alternativa **falla en
 * silencio**. Contar `..` acopla un fichero a su profundidad en el
 * árbol, y durante la reorganización eso mordió tres veces seguidas: al
 * mover los gates a `scripts/gates/`, al mover el plugin a `projects/`,
 * y otra vez al meterlo en `projects/plugins/`. Ninguna de las tres
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
 * eso está `findRepoRoot()` en `projects/core/helpers/`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Marcadores que identifican la raíz del repo.
 *
 * `package.json` a secas no vale: lo tienen también los paquetes de
 * `projects/plugins/*`, y la búsqueda pararía en el primero. Se exige
 * que estén los dos.
 */
const ROOT_MARKERS = ["package.json", "mcp-vertex.config.json"] as const;

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
export const PROJECTS_DIR = fromRoot("projects");

/** Núcleo agnóstico: no nombra ni un framework. */
export const CORE_DIR = join(PROJECTS_DIR, "core");
export const CORE_CONTRACTS_DIR = join(CORE_DIR, "contracts");
export const CORE_DOMAIN_DIR = join(CORE_DIR, "domain");
export const CORE_DISCOVERY_DIR = join(CORE_DIR, "discovery");
export const CORE_ADAPTERS_DIR = join(CORE_DIR, "adapters");
export const CORE_HELPERS_DIR = join(CORE_DIR, "helpers");

/** Lo concreto de cada framework. */
export const FRAMEWORKS_DIR = join(PROJECTS_DIR, "frameworks");
export const FRAMEWORKS_SCANNERS_DIR = join(FRAMEWORKS_DIR, "scanners");
export const FRAMEWORKS_PARSERS_DIR = join(FRAMEWORKS_DIR, "parsers");

/** Raíz de composición: el CLI. */
export const CLI_DIR = join(PROJECTS_DIR, "cli");
export const CLI_COMMANDS_DIR = join(CLI_DIR, "commands");
/** El dispatcher. Es el `bin` del paquete y el entrypoint del binario. */
export const CLI_ENTRYPOINT = join(CLI_DIR, "cli.script.ts");

/** Asistente interactivo. */
export const UI_DIR = join(PROJECTS_DIR, "ui");

/** Plugins, uno por host. */
export const PLUGINS_DIR = join(PROJECTS_DIR, "plugins");
/** El plugin de un host concreto. Hoy solo `mcp-vertex`. */
export function pluginDir(host: string): string {
  return join(PLUGINS_DIR, host);
}
export const MCP_VERTEX_PLUGIN_DIR = pluginDir("mcp-vertex");

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
export const PROPOSALS_DIR = join(DOCS_DIR, "mcp-vertex", "proposals");

// ---------------------------------------------------------------------------
// Ficheros sueltos que se leen o escriben desde el tooling
// ---------------------------------------------------------------------------

export const PACKAGE_JSON = fromRoot("package.json");
/** Config del host mcp-vertex: qué plugins carga y desde dónde. */
export const MCP_VERTEX_CONFIG = fromRoot("mcp-vertex.config.json");
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
  PROJECTS_DIR,
  CORE_DIR,
  CORE_CONTRACTS_DIR,
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
  PLUGINS_DIR,
  MCP_VERTEX_PLUGIN_DIR,
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
  MCP_VERTEX_CONFIG,
  MCP_JSON,
  VSCODE_DIR,
  VSCODE_MCP_JSON,
};
