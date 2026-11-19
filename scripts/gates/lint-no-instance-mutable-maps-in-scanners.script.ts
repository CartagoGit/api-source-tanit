#!/usr/bin/env bun
/**
 * `bun run lint:no-instance-mutable-maps-in-scanners` —
 * ningún `IRouteScanner` declara un `Map` o `Set` como `private`
 * field de instancia.
 *
 * El estado mutable entre llamadas a `scan()` es la fuente del bug
 * que cerró a00010 S2. Cuatro scanners (Fastify, Hono, Fiber, Rust)
 * guardaban en un `Map<routeKey, T>` lo que el escaneo iba
 * encontrando, y la siguiente invocación lo heredaba: dos escaneos
 * sobre el mismo framework contaminaban el resultado. Hoy ese
 * estado vive en un `Map` local dentro de `scan()`, se descarta al
 * volver y se entrega como `IScanResult.schemas | validators |
 * structs`, no como acoplamiento al scanner.
 *
 * `private readonly X = new Map(...)` y `private X = new Set(...)`
 * son las dos formas que detecta el lint, en cualquier clase
 * declarada en el mismo fichero que implemente `IRouteScanner`.
 *
 * Uso:
 *   bun run lint:no-instance-mutable-maps-in-scanners
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Carpetas que no se recorren. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "fixtures",
  "smoke-fixtures",
  "docs",
]);

/** El propio lint menciona el patrón: no puede acusarse a sí mismo. */
const ALLOWED = new Set([
  "scripts/gates/lint-no-instance-mutable-maps-in-scanners.script.ts",
]);

/**
 * ¿La clase `ClsName` declara `implements IRouteScanner`?
 *
 * Busca una cadena `class ClsName ... implements IRouteScanner` en
 * `source`. Es una heurística que falla si la clase está declarada a
 * lo largo de varias líneas con comentarios entre medias, pero ese
 * no es el estilo del repo: los veintiún scanners lo escriben en una
 * sola línea.
 */
function classImplementsIRouteScanner(source: string, className: string): boolean {
  const re = new RegExp(
    String.raw`\bclass\s+${className}\b[^{]*\bimplements\s+IRouteScanner\b`,
  );
  return re.test(source);
}

/**
 * ¿La línea declara un field de instancia `Map` / `Set` inicializado?
 *
 * Captura los tres sabores del bug real y la tentación obvia:
 *
 *   private readonly X = new Map<...>();
 *   private X = new Map<...>();
 *   private readonly X = new Set<...>();
 *
 * Lo NO que captura: un `Map` *local* dentro de un método. Eso es
 * exactamente lo que hay que hacer (a00010 S2 lo cerró así en los
 * cuatro scanners), y por eso el lint mira el carácter de nueva
 * línea: el field vive a nivel de clase, sin `function` ni `=>`
 * por delante.
 */
const FIELD_DECL = /^\s*private(\s+readonly)?\s+\w+\s*=\s*new\s+(Map|Set)\s*[<(]/;

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

async function main(): Promise<number> {
  const files = await collect(REPO_ROOT);
  const problems: string[] = [];
  let checked = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (ALLOWED.has(rel)) continue;

    const source = await readFile(file, "utf8");

    // Identifica los nombres de clase en este fichero y filtra los
    // que implementan `IRouteScanner`. Se cogen todos los `class X`
    // (capturando `export` opcional delante) hasta la primera `{`,
    // que es lo que los veintiún scanners del repo escriben en una
    // sola línea.
    const classNames = [...source.matchAll(/\bclass\s+(\w+)[^{]*\{/g)];
    const scannerClasses = classNames
      .map((m) => m[1])
      .filter((name): name is string => Boolean(name))
      .filter((name) => classImplementsIRouteScanner(source, name));

    if (scannerClasses.length === 0) continue;
    checked++;

    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!FIELD_DECL.test(line)) continue;
      problems.push(
        `${rel}:${i + 1}\n      ${line.trim()}\n` +
          `      un campo \`new Map\` / \`new Set\` a nivel de instancia\n` +
          `      sobrevive entre llamadas a \`scan()\` y contamina el siguiente\n` +
          `      escaneo (a00010 B-06). Declara el \`Map\` dentro del método\n` +
          `      \`scan()\` y devuélvelo como parte del \`IScanResult\`.`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:no-instance-mutable-maps-in-scanners — ${problems.length} scanner(s) con estado mutable de instancia:\n`,
    );
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    return 1;
  }

  console.log(
    `lint:no-instance-mutable-maps-in-scanners — ${checked} scanner(s) revisado(s), ninguno lleva \`Map\` / \`Set\` de instancia`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
