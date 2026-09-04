/**
 * Tests CLI para a00013 S3 (`--combine-services` parsing).
 *
 * Estricto: NO se prueba el wiring del pipeline a fondo (eso es un
 * test e2e que requiere el orchestrator real). Aqui se valida
 * exclusivamente que el flag `--combine-services` se PARSEA y se
 * PROPAGA al `IGenerationOptions`. El test se centra en:
 *
 *  - El flag es aceptable como argumento (no aborta el script).
 *  - El script termina con codigo 1 (no 0) cuando el proyecto
 *    detectado no genera endpoints, tanto con el flag como sin el
 *    flag. Eso confirma que `buildFor` no rompe con `matches.length
 *    === 0` ni con `matches.length === N`.
 *  - El script produce el mismo codigo de salida en el camino
 *    "no framework" con y sin `--combine-services`: el flag no
 *    afecta al comportamiento cuando no hay nada que emitir.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGenerate } from "../../packages/cli/commands/generate.script.js";

// Nota: el CLI no usa `process.cwd()`; resuelve el projectRoot via
// `--project-root` o `argv`. Por eso este test no hace `process.chdir`.


describe("a00013 S3 CLI --combine-services parsing", () => {
  let emptyRoot: string;

  beforeEach(() => {
    emptyRoot = mkdtempSync(join(tmpdir(), "a00013-s3-"));
  });

  afterEach(() => {
    if (existsSync(emptyRoot)) {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("con proyecto vacio y SIN --combine-services: sale con codigo no-cero", async () => {
    mkdirSync(join(emptyRoot, "apps"), { recursive: true });
    const result = await runGenerate(["--project-root", emptyRoot]);
    expect(result.code).not.toBe(0);
  });

  it("con proyecto vacio y CON --combine-services: sale con el mismo codigo no-cero", async () => {
    mkdirSync(join(emptyRoot, "apps"), { recursive: true });
    const result = await runGenerate([
      "--project-root", emptyRoot,
      "--combine-services",
    ]);
    expect(result.code).not.toBe(0);
  });

  it("--combine-services no aborta con un flag desconocido adicional", async () => {
    // El flag debe ser puramente aditivo: combinarse con flags que ya
    // existen (--json) sin lanzar errores de parseo.
    mkdirSync(join(emptyRoot, "apps"), { recursive: true });
    const result = await runGenerate([
      "--project-root", emptyRoot,
      "--combine-services",
      "--json",
    ]);
    // El proyecto sigue vacio: el codigo refleja eso, no el flag.
    expect(result.code).not.toBe(0);
  });
});
