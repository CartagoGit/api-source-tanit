#!/usr/bin/env bun
/**
 * `bun run lint:fixtures` — no fixtures vacíos o incompletos en `develop`.
 *
 * Una fixture declarada como "completa" (en `tests/fixtures/`) o como
 * smoke (en `tests/smoke-fixtures/`) debe llegar a `develop` con:
 *
 *   - al menos un manifiesto (`package.json`, `composer.json`, `*.csproj`,
 *     `Cargo.toml`, `go.mod`, `pyproject.toml`, `build.gradle`,
 *     `build.gradle.kts`, `pom.xml`, `mix.exs`),
 *   - al menos un fichero fuente (extensión reconocible),
 *   - para fixtures multi-servicio (un subdirectorio `apps/`,
 *     `services/` o `packages/`), cada servicio hijo tiene su propio
 *     manifiesto Y su propia fuente.
 *
 * Sin esto es trivial meter una fixture vacía en `develop`: el
 * scanner devuelve 0 rutas, el test pasa como "PASS — 0 endpoints
 * detectados", y la cobertura de ese framework baja en silencio.
 * La auditoría 2026-09-06 (sección 1) lo documenta: tres tests
 * estaban en rojo por fixtures a medio poblar mientras un agente
 * trabajaba en ellas en paralelo, y el lector del CI no tenía forma
 * de distinguir "el runtime está roto" de "alguien dejó el
 * `package.json` solo".
 *
 * Uso:
 *   bun run lint:fixtures
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

import { FIXTURES_DIR, SMOKE_FIXTURES_DIR } from "../helpers/root.helper.js";

/**
 * Source-file extensions recognized as "evidence of a real app"
 * or a real spec file that the scanners can read.
 *
 * The list is intentionally permissive: missing one is worse than
 * having one too many. The scanners that consume fixtures are
 * registered in `packages/frameworks/`; if a fixture for a
 * framework uses an extension not in this list, the right fix is to
 * add the extension here with a one-line comment, not to special-
 * case the fixture.
 */
const SOURCE_EXTENSIONS = [
  // Code.
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".php",
  ".rb",
  ".cs",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".ex", // Phoenix / Elixir
  ".exs", // Phoenix / Elixir scripts + manifests
  ".scala",
  ".groovy",
  // Specs the scanners can read directly.
  ".yaml",
  ".yml",
  ".json",
  ".graphql",
  ".gql",
  ".proto",
  ".avsc", // Avro
] as const;

/**
 * Manifest filenames recognized as "this directory has a real project".
 *
 * `*.csproj` is a glob and handled in `dirHasManifest` directly; we
 * keep it in this list for documentation.
 */
const MANIFEST_NAMES = [
  "package.json",
  "composer.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "*.csproj",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "mix.exs",
  "Gemfile",
] as const;

/** Subdirectory patterns that signal a multi-service fixture. */
const MULTI_SERVICE_DIRS = ["apps", "services", "packages", "modules"] as const;

interface IIssue {
  readonly fixture: string;
  readonly kind: "no-manifest" | "no-sources" | "empty-multi-service-child";
  readonly detail: string;
}

async function listDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
}

async function dirHasManifest(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if ((MANIFEST_NAMES as ReadonlyArray<string>).includes(entry.name)) return true;
    // Glob-style entries in MANIFEST_NAMES (`*.csproj`).
    for (const pattern of MANIFEST_NAMES) {
      if (pattern.startsWith("*.") && entry.name.endsWith(pattern.slice(1))) {
        return true;
      }
    }
  }
  return false;
}

async function dirHasSources(dir: string): Promise<boolean> {
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      // A manifest is not a source: `package.json` ends in `.json`
      // and would otherwise count. Without this exclusion, every
      // fixture that has `package.json` would silently pass the
      // "has sources" check, defeating the gate.
      if (isManifest(entry.name)) continue;
      for (const ext of SOURCE_EXTENSIONS) {
        if (entry.name.endsWith(ext)) return true;
      }
    }
  }
  return false;
}

/**
 * Same matching rules as `dirHasManifest`: an exact name or a glob
 * (`*.csproj`). Kept as a single source of truth so the two helpers
 * cannot drift.
 */
function isManifest(name: string): boolean {
  for (const pattern of MANIFEST_NAMES) {
    if (pattern.startsWith("*.")) {
      if (name.endsWith(pattern.slice(1))) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
}

async function listSubdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name));
}

async function lintOne(
  fixtureDir: string,
  issues: IIssue[],
): Promise<void> {
  const name = relative(join(fixtureDir, "..", ".."), fixtureDir);

  const hasManifest = await dirHasManifest(fixtureDir);
  const hasSources = await dirHasSources(fixtureDir);

  if (!hasManifest && !hasSources) {
    // Both missing — clearly empty, refuse regardless of intent.
    issues.push({
      fixture: name,
      kind: "no-manifest",
      detail:
        "no se encontró ningún manifiesto (package.json, composer.json, *.csproj…) " +
        "ni ficheros fuente reconocibles",
    });
    return;
  }

  // Spec-only fixtures (OpenAPI, GraphQL standalone) have a
  // recognisable spec file but no project manifest — that is fine.
  // The scanner consumes the spec directly. We only flag
  // "no-manifest" when there is also no spec to scan.
  if (!hasManifest && !hasSources) {
    issues.push({
      fixture: name,
      kind: "no-manifest",
      detail:
        "no se encontró ningún manifiesto ni un fichero de spec " +
        "(openapi.yaml, schema.graphql…)",
    });
    return;
  }

  // Has a manifest but no source code — the scanner would always
  // return zero routes, which is the failure mode the audit warns
  // against. Refuse.
  if (hasManifest && !hasSources) {
    issues.push({
      fixture: name,
      kind: "no-sources",
      detail:
        "la fixture tiene un manifiesto pero ningún fichero fuente " +
        "(.ts, .js, .py, .php, .rb, .cs, .go, .rs, .java, .kt, .ex, .graphql, .yaml…)",
    });
    return;
  }

  // At this point we have at least sources. Multi-service rules:
  // each child under apps/ / services/ / packages/ must have its
  // OWN manifest + sources, because the per-service scanner walks
  // them independently. A spec-only fixture without children does
  // not enter this branch.
  for (const multiName of MULTI_SERVICE_DIRS) {
    const multiDir = join(fixtureDir, multiName);
    if (!existsSync(multiDir)) continue;
    const children = await listSubdirs(multiDir);
    for (const child of children) {
      if (!(await dirHasManifest(child))) {
        issues.push({
          fixture: `${name}/${multiName}/${relative(multiDir, child)}`,
          kind: "empty-multi-service-child",
          detail: "servicio hijo sin manifiesto",
        });
        continue;
      }
      if (!(await dirHasSources(child))) {
        issues.push({
          fixture: `${name}/${multiName}/${relative(multiDir, child)}`,
          detail: "servicio hijo sin ficheros fuente",
          kind: "empty-multi-service-child",
        });
      }
    }
  }
}

async function main(): Promise<number> {
  const issues: IIssue[] = [];

  for (const dir of await listDirs(FIXTURES_DIR)) {
    await lintOne(dir, issues);
  }
  for (const dir of await listDirs(SMOKE_FIXTURES_DIR)) {
    await lintOne(dir, issues);
  }

  if (issues.length === 0) {
    console.log(
      `ok   ${FIXTURES_DIR.split("/").pop()} + ${SMOKE_FIXTURES_DIR
        .split("/")
        .pop()}  todas las fixtures tienen manifiesto + fuente`,
    );
    return 0;
  }

  console.error(
    `FAIL ${issues.length} issue(s) encontrado(s) en las fixtures:\n`,
  );
  for (const issue of issues) {
    console.error(
      `  [${issue.kind}] ${issue.fixture}\n      ${issue.detail}`,
    );
  }
  console.error(
    `\nEsto es lo que el audit 2026-09-06 (sección 1) llama "estado intermedio de otros agentes": ` +
      `un paquete.json solo en develop baja la cobertura del framework sin avisar. ` +
      `Completa la fixture o elimínala si ya no aplica.`,
  );
  return 1;
}

if (import.meta.main) {
  await main();
}

export {};
