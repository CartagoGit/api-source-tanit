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
 *   - al menos un fichero fuente real (código o spec que el scanner
 *     consume), no `expected.json` / `package.json` / `tsconfig.json`,
 *   - para fixtures multi-servicio (un subdirectorio `apps/`,
 *     `services/`, `packages/` o `modules/`), cada servicio hijo
 *     tiene su propio manifiesto Y su propia fuente.
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
 * (the framework's primary language) or a real spec file that the
 * scanners can read directly.
 *
 * The list is intentionally permissive: missing one is worse than
 * having one too many. The scanners that consume fixtures are
 * registered in `packages/frameworks/`; if a fixture for a
 * framework uses an extension not in this list, the right fix is to
 * add the extension here with a one-line comment, not to special-
 * case the fixture.
 */
const CODE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".php", ".rb", ".cs", ".go", ".rs",
  ".java", ".kt", ".kts", ".swift",
  ".ex", // Phoenix / Elixir
  ".exs", // Elixir scripts
  ".scala", ".groovy",
] as const;

/**
 * Spec files the scanners can read directly. These are NOT source
 * code but they ARE evidence of a real project: a bare `openapi.yaml`
 * is a valid scanner input.
 *
 * Why `.json` is NOT in this list: `expected.json`, `package.json`,
 * `tsconfig.json` and every other config file ends in `.json`. A
 * naïve "ends with `.json` ⇒ has source" check was the bug that the
 * 2026-09-06 second audit (section 9) caught: the Express fixture
 * that motivated the audit had `expected.json` + `package.json` and
 * no `.js`, and the gate considered it valid.
 *
 * The spec files that DO belong here follow a strict pattern: the
 * basename identifies the SPEC (not the assertion) and they are
 * recognised by the scanners in `packages/frameworks/openapi/`,
 * `packages/frameworks/graphql/`, etc.
 */
const SPEC_PATTERNS: ReadonlyArray<RegExp> = [
  /^openapi.*\.(json|ya?ml)$/i,
  /^swagger.*\.(json|ya?ml)$/i,
  /(^|\/)(schema|schemas?)\.(graphql|gql|sdl)$/i,
  /\.proto$/i,
  /\.avsc$/i,
  // Symfony routing config — not "code" by our extension list, but
  // the scanner consumes it as the primary source. Without this
  // pattern every symfony-* fixture trips the gate.
  /(^|\/)config\/routes(\/.*)?\.(ya?ml|php)$/i,
  // Laravel routing — the scanner reads these too.
  /(^|\/)routes\/(api|web|console|channels)\.php$/i,
];

/**
 * Manifest filenames recognized as "this directory has a real project".
 *
 * `*.csproj` is a glob and handled in `isManifest` directly; we keep
 * it in this list for documentation.
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

export type FixtureIssueKind =
  | "no-manifest"
  | "no-sources"
  | "empty-multi-service-child";

export interface IFixtureIssue {
  readonly fixture: string;
  readonly kind: FixtureIssueKind;
  readonly detail: string;
}

async function listDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
}

/**
 * Matches an exact name or a glob (`*.csproj`). Single source of
 * truth for "is this filename a manifest?" used by both
 * `dirHasManifest` and `dirHasSources`.
 */
export function isManifest(name: string): boolean {
  for (const pattern of MANIFEST_NAMES) {
    if (pattern.startsWith("*.")) {
      if (name.endsWith(pattern.slice(1))) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Matches a recognized spec file (openapi.*, swagger.*, schema.graphql,
 * .proto, .avsc). Conservative on purpose: a file that does not
 * match these patterns AND does not have a code extension AND is not
 * a manifest is NOT a source.
 */
export function isSpecFile(name: string): boolean {
  for (const pattern of SPEC_PATTERNS) {
    if (pattern.test(name)) return true;
  }
  return false;
}

export async function dirHasManifest(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (isManifest(entry.name)) return true;
  }
  return false;
}

export async function dirHasSources(dir: string): Promise<boolean> {
  const stack: Array<{ absDir: string; relDir: string }> = [
    { absDir: dir, relDir: "" },
  ];
  while (stack.length > 0) {
    const { absDir, relDir } = stack.pop()!;
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(absDir, entry.name);
      const rel = relDir === "" ? entry.name : join(relDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push({ absDir: full, relDir: rel });
        continue;
      }
      if (!entry.isFile()) continue;
      if (isFixtureSource(rel)) return true;
    }
  }
  return false;
}

/**
 * A file is "source evidence" if it is:
 *   - a recognised code file (CODE_EXTENSIONS), OR
 *   - a recognised spec file (SPEC_PATTERNS), AND
 *   - NOT a manifest.
 *
 * Manifests are excluded so a fixture with `package.json` only does
 * not pass the gate. `expected.json` is excluded because it is the
 * assertion, not the implementation.
 */
export function isFixtureSource(name: string): boolean {
  if (isManifest(name)) return false;
  for (const ext of CODE_EXTENSIONS) {
    if (name.endsWith(ext)) return true;
  }
  if (isSpecFile(name)) return true;
  return false;
}

async function listSubdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name));
}

/**
 * Lints a single fixture root. Exported so tests can drive the
 * check against synthetic fixtures in temp directories without
 * copying the source-scan logic (the second audit 2026-09-06 §12
 * called out the literal-copy approach as a regression risk).
 */
export async function lintFixture(
  fixtureDir: string,
): Promise<ReadonlyArray<IFixtureIssue>> {
  const issues: IFixtureIssue[] = [];
  // Display name: relative path from the fixture roots' parent so
  // `tests/fixtures/hono-comprehensive` shows as
  // `fixtures/hono-comprehensive`, but a synthetic temp fixture
  // (used by tests) shows its absolute path.
  const name = relative(join(fixtureDir, "..", ".."), fixtureDir);

  const hasManifest = await dirHasManifest(fixtureDir);
  const hasSources = await dirHasSources(fixtureDir);

  // Multi-service detection: if the fixture has a recognised
  // multi-service subdirectory, the root is allowed to have only a
  // workspace manifest; the children carry the actual sources.
  // Audit 2026-09-06 second pass §10: previously the gate reported
  // "no sources" on the root and never even looked at the children.
  const multiName = MULTI_SERVICE_DIRS.find((d) =>
    existsSync(join(fixtureDir, d)),
  );
  const multiDir = multiName !== undefined ? join(fixtureDir, multiName) : undefined;

  if (!hasManifest && !hasSources) {
    issues.push({
      fixture: name,
      kind: "no-manifest",
      detail:
        "no se encontró ningún manifiesto (package.json, composer.json, *.csproj…) " +
        "ni ficheros fuente reconocibles",
    });
    return issues;
  }

  // Root-level sources check, with multi-service exception: in a
  // monorepo fixture, the per-service sources live under apps/ (or
  // services/, etc.), not at the root.
  if (multiDir === undefined && hasManifest && !hasSources) {
    issues.push({
      fixture: name,
      kind: "no-sources",
      detail:
        "la fixture tiene un manifiesto pero ningún fichero fuente real " +
        "— un `expected.json` o `package.json` solo NO cuenta; el scanner " +
        "devolvería 0 rutas y la cobertura del framework bajaría en silencio.",
    });
    return issues;
  }

  // Multi-service: each child must have its OWN manifest + sources.
  // This is the actual failure mode the audit warns about
  // (apps/orders/ con package.json solo → cobertura perdida).
  if (multiDir !== undefined && multiName !== undefined) {
    const children = await listSubdirs(multiDir);
    if (children.length === 0) {
      issues.push({
        fixture: name,
        kind: "no-sources",
        detail: `la fixture tiene \`${multiName}/\` pero está vacío`,
      });
      return issues;
    }
    for (const child of children) {
      // Include the multi-service prefix (`apps/`, `services/`, …)
      // so the diagnostic identifies WHICH child in WHICH group is
      // empty. `relative(multiDir, child)` already strips the
      // parent, so we re-add it.
      const childName = `${name}/${multiName}/${relative(multiDir, child)}`;
      const childManifest = await dirHasManifest(child);
      const childSources = await dirHasSources(child);
      if (!childManifest && !childSources) {
        issues.push({
          fixture: childName,
          kind: "empty-multi-service-child",
          detail: "servicio hijo sin manifiesto ni fuente",
        });
        continue;
      }
      if (childManifest && !childSources) {
        issues.push({
          fixture: childName,
          kind: "empty-multi-service-child",
          detail:
            "servicio hijo con package.json pero sin ficheros fuente — " +
            "el scanner devolvería 0 rutas para este servicio",
        });
        continue;
      }
    }
  }

  return issues;
}

async function main(): Promise<number> {
  const issues: IFixtureIssue[] = [];

  for (const dir of await listDirs(FIXTURES_DIR)) {
    issues.push(...(await lintFixture(dir)));
  }
  for (const dir of await listDirs(SMOKE_FIXTURES_DIR)) {
    issues.push(...(await lintFixture(dir)));
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
  // `process.exit(await main())` (and `process.exitCode = await main()`)
  // were missing in the previous slice: the gate printed FAIL but
  // exited with 0, so the parent `bun run lint` chain kept going.
  // Audit 2026-09-06 second pass §8 caught this. Without one of these
  // two, the gate is decorative, not blocking.
  process.exit(await main());
}

export {};
