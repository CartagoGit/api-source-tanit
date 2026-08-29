#!/usr/bin/env bun
/**
 * Smoke test del discovery framework-agnostic.
 *
 * Uso:
 *   bun scripts/scan.script.ts
 *   bun scripts/scan.script.ts --project-root /path/to/project
 *   POSTMAN_PROJECT_ROOT=/path/to/project bun scripts/scan.script.ts
 *
 * Recorre los `IProjectScanner` registrados, elige el de mayor score,
 * e imprime las rutas encontradas. Pensado para CI y para debugging
 * del discovery sin tener que generar una colección completa.
 *
 * ## Por qué `runScan` está separado de `main`
 *
 * Mismo motivo que en `generate`, `check` y `list`: el tool del plugin
 * necesita **los datos**, y parsear la salida con regex se rompe el día
 * que cambie una columna.
 *
 * Y hay una razón más urgente. Este fichero llamaba a
 * `process.exit(await main())` **sin guard**, en el cuerpo del módulo:
 * cualquiera que lo importara —un test, el plugin— lanzaba un escaneo y
 * mataba el proceso. En un servidor MCP de vida larga eso es el servidor
 * entero cayéndose al cargar el tool. Estaba así en cuatro de los doce
 * comandos, y `lint:command-coverage` ahora lo exige.
 */
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";
import { guessedRootNotice, resolveRoot } from "../../core/helpers/resolve-root.helper.js";
import type { IScanOutcome } from "../../contracts/interfaces/cli/scan-outcome.interface.js";

/** Escanea el proyecto y devuelve lo encontrado, imprimiéndolo por el camino. */
export async function runScan(
  argv: string[] = process.argv.slice(2),
): Promise<IScanOutcome> {
  const resolved = resolveRoot({ argv });
  const root = resolved.root;

  // Decir cuando se ha adivinado: el último recurso es el directorio
  // actual, y escanear el sitio equivocado en silencio es cómo `watch`
  // acabó recorriendo `/tmp` entero.
  const aviso = guessedRootNotice(resolved);
  if (aviso) console.log(`${aviso}\n`);

  console.log(`→ Scanning ${root}\n`);

  const vacio = { root, artifacts: [], routes: [] } as const;

  const orch = defaultOrchestrator();

  const { match, scanner, validation } = await orch.detectProject(root);
  if (!match) {
    console.error(
      "✘ No framework detected. Check the path, or add an IProjectScanner.",
    );
    return { ...vacio, code: 1, framework: null, scanner: null, validation: null };
  }

  const nombreScanner = scanner?.constructor.name ?? null;
  const nombreValidacion = validation?.constructor.name ?? null;

  console.log(`✔ Winning framework: ${match.framework}`);
  console.log(`  · Artifacts:     ${match.artifacts.join(", ") || "(ninguno)"}`);
  console.log(`  · RouteScanner:  ${nombreScanner ?? "(none)"}`);
  console.log(`  · Validation:    ${nombreValidacion ?? "(none)"}\n`);

  if (!scanner) {
    console.error("✘ The project matched, but there is no route scanner for this framework.");
    return {
      ...vacio,
      code: 1,
      framework: match.framework,
      artifacts: match.artifacts,
      scanner: null,
      validation: nombreValidacion,
    };
  }

  const routes = await scanner.scan(match);
  console.log(`✔ ${routes.length} routes discovered:\n`);
  for (const r of routes) {
    const tags = r.tags?.length ? ` [${r.tags.join(", ")}]` : "";
    const desc = r.description ? ` — ${r.description}` : "";
    console.log(`  ${r.method.padEnd(6)} ${r.uri}${tags}${desc}`);
  }

  return {
    code: 0,
    root,
    framework: match.framework,
    artifacts: match.artifacts,
    scanner: nombreScanner,
    validation: nombreValidacion,
    routes: routes.map((r) => ({
      method: r.method,
      uri: r.uri,
      tags: r.tags ?? [],
      description: r.description ?? null,
    })),
  };
}

/** La envoltura que usa el CLI: solo el código de salida. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runScan(argv)).code;
}

if (import.meta.main) {
  process.exit(await main());
}
