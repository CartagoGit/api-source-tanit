#!/usr/bin/env bun
/**
 * `bun run lint:root-allowlist` — rechaza ficheros no permitidos en la raíz del repo.
 * x00047 S1.
 *
 * Por qué existe
 * ──────────────
 * El incidente del fichero `t` (13 KB de ayuda de `less` commiteada en
 * develop) y su gemelo `ondeo` (mismo origen, mismo shape) demostraron que
 * `lint:clean-tree` no basta: ese gate mira `git status` (worktree) y NO
 * detecta basura ya commiteada.
 *
 * La fix correcta es una allowlist versionada de paths permitidos en la
 * raíz del repo. Si un agente commitea algo que no está en la allowlist,
 * el gate falla con la lista exacta de offenders. La allowlist es
 * explícita y cada entrada documenta por qué está permitida.
 *
 * Qué considera violación
 * ───────────────────────
 * - `git ls-files` en la raíz (path relativo de 1 segmento, sin `/`).
 * - Si el path no está en `ALLOW` y no es un dotfile (`.x` reservado para
 *   configuración del repo / host: `.gitignore`, `.editorconfig`,
 *   `.dockerignore`, `.gitattributes`…), falla.
 * - Dotfiles permitidos son los enumerados en `ALLOW_DOTFILES`; el resto
 *   también falla. Esto cierra el patrón "agente deja `.foo`" — quien
 *   quiera uno nuevo debe añadirlo a la lista explícita con motivo.
 *
 * Excepciones
 * ───────────
 * - `TANIT_ALLOW_ROOT_FILES=1` desactiva el gate (modo dev). Pensado para
 *   sesiones donde el agente está iterando con un fichero local que NO va
 *   a commit-earse. NO usar para saltarse la regla en general.
 *
 * Uso
 * ───
 *   bun run lint:root-allowlist
 *   TANIT_ALLOW_ROOT_FILES=1 bun run lint:root-allowlist  # no falla
 *
 * Salida
 * ──────
 * - 0 si no hay infracciones.
 * - 1 con la lista exacta de offenders si los hay.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { REPO_ROOT } from "../helpers/root.helper.js";

const execFileAsync = promisify(execFile);

/**
 * Allowlist de paths explícitamente permitidos en la raíz del repo.
 *
 * Cada entrada se justifica. Si la quitas, documenta por qué.
 *
 * Esta lista NO es exhaustiva: crecerá con el repo. La disciplina
 * importante es que cualquier adición sea explícita.
 */
const ALLOW: ReadonlyArray<{ readonly path: string; readonly reason: string }> = [
  // Documentación de entrada al repo.
  { path: "README.md", reason: "Entrada del repo en GitHub" },
  { path: "LICENSE", reason: "MIT" },
  { path: "CHANGELOG.md", reason: "Cambios por release (visible en npm)" },
  { path: "CONTRIBUTING.md", reason: "Cómo contribuir" },

  // Manifiestos del proyecto.
  { path: "package.json", reason: "Manifiesto del producto (publicado)" },
  { path: "bun.lock", reason: "Lockfile del runtime Bun" },

  // TypeScript configs.
  { path: "tsconfig.json", reason: "Aggregator del typecheck" },
  { path: "tsconfig.base.json", reason: "Base del typecheck" },
  { path: "tsconfig.contracts.json", reason: "Sección contracts" },
  { path: "tsconfig.core.json", reason: "Sección core" },
  { path: "tsconfig.frameworks.json", reason: "Sección frameworks" },
  { path: "tsconfig.cli.json", reason: "Sección cli" },

  // Test runner.
  { path: "vitest.config.ts", reason: "Config de vitest" },

  // Producto.
  { path: "bin", reason: "Lanzador del CLI (binario apisrc)" },
  { path: "packages", reason: "Producto: cli, core, contracts, frameworks, ui" },
  { path: "scripts", reason: "Gates, helpers y build del producto" },
  { path: "tests", reason: "Suites del producto" },
  { path: "examples", reason: "Proyectos de ejemplo (21 frameworks)" },
  { path: "docs", reason: "Documentación del proyecto" },

  // Integraciones opcionales (x00041). NO se distribuyen con el producto
  // pero viven aquí para conveniencia del usuario.
  { path: "integrations", reason: "Integraciones opcionales con hosts MCP (x00041)" },

  // Salida de `validate:examples` sobre `example-app`. Se commitea como
  // artefacto de referencia para que el usuario vea qué produce el CLI
  // sin tener que ejecutarlo.
  { path: "export-to-postman", reason: "Salida de generate sobre example-app" },

  // Configuración del host MCP y del repo.
  { path: "delendai.config.json", reason: "Config del host MCP Delendai" },
  { path: ".mcp.json", reason: "Servidores MCP locales para desarrollo" },
  { path: ".vscode", reason: "Config local de VS Code (regenerada por lint:mcp)" },
  { path: ".github", reason: "Workflows y agents del repo" },
  { path: ".docker", reason: "Compose + scripts Docker (release)" },
  { path: ".dockerignore", reason: "Contexto para Docker build" },
  { path: ".editorconfig", reason: "Convención de estilo cross-editor" },
  { path: ".gitignore", reason: "Política de ignorar" },
  { path: ".gitattributes", reason: "Atributos de Git (eol, diff)" },
  { path: ".claude", reason: "Agents de Claude Code (pointers al bootstrap)" },

  // Pointers del orchestrator (no contienen narrativa propia).
  { path: "AGENTS.md", reason: "Pointer al AGENT-BOOTSTRAP" },
  { path: "CLAUDE.md", reason: "Pointer al AGENT-BOOTSTRAP" },
];

/** Dotfiles en raíz que NO son path-level (`ALLOW` ya cubre los que son dirs). */
const ALLOW_DOTFILES = new Set<string>([
  ".gitignore",
  ".gitattributes",
  ".dockerignore",
  ".editorconfig",
]);

async function listRootTracked(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    maxBuffer: 4 * 1024 * 1024,
  });
  const out = new Set<string>();
  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    const first = line.split("/")[0]!;
    out.add(first);
  }
  return [...out];
}

function isAllowed(path: string): boolean {
  // Primero comprobar la allowlist explícita — si el path está
  // permitido, pasa. Después, para paths con punto inicial que NO
  // están en la allowlist, sólo permitimos los dotfiles "estándar"
  // (.gitignore, .editorconfig, etc.).
  if (ALLOW.some((entry) => entry.path === path)) {
    return true;
  }
  if (path.startsWith(".")) {
    return ALLOW_DOTFILES.has(path);
  }
  return false;
}

export async function main(): Promise<number> {
  if (process.env.TANIT_ALLOW_ROOT_FILES === "1") {
    console.log("lint:root-allowlist -- desactivado por TANIT_ALLOW_ROOT_FILES=1");
    return 0;
  }

  const root = await listRootTracked();
  const offenders = root.filter((p) => !isAllowed(p));

  if (offenders.length === 0) {
    console.log(
      `lint:root-allowlist -- ${root.length} paths en raíz, todos permitidos`,
    );
    return 0;
  }

  console.error(
    "lint:root-allowlist -- " +
      offenders.length +
      " path(s) en raíz no permitidos:",
  );
  for (const o of offenders) {
    console.error(`  - ${o}`);
  }
  console.error("");
  console.error("Para añadir un path legítimo a la allowlist:");
  console.error(
    "  edita scripts/gates/lint-root-allowlist.script.ts (const ALLOW)",
  );
  console.error(
    "  y documenta el motivo. No usar TANIT_ALLOW_ROOT_FILES=1 para",
  );
  console.error("saltarse la regla en general.");
  console.error("");
  console.error("Permitidos actualmente (resumen):");
  for (const entry of ALLOW) {
    console.error(`  ${entry.path}  — ${entry.reason}`);
  }
  return 1;
}

if (import.meta.main) {
  const code_ = await main();
  process.exit(code_);
}