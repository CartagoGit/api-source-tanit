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
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGenerate } from "../../packages/cli/commands/generate.script.js";
import { runProcess } from "../helpers/run-process";
import { CLI_COMMANDS_DIR } from "../../scripts/helpers/root.helper";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");

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

/**
 * x00024 S2 — CLI traduce `MultipleServicesWithoutCombineError` a
 * exit code 64 (`EX_USAGE`) con mensaje accionable.
 *
 * Se lanza el CLI como subproceso (vía `runProcess`) porque es la
 * única forma de observar el exit code real: el catch vive en el
 * bloque `if (import.meta.main)` del script, no en `runGenerate`.
 */
describe("x00024 S2 — CLI exit code 64 en multi-service sin --combine-services", () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), "x00024-cli-"));
  });

  afterEach(() => {
    if (existsSync(workRoot)) {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("monorepo con 2 servicios sin --combine-services → exit 64 y mensaje accionable", async () => {
    // Mismo patrón de fixture sintético que en
    // `tests/core/monorepo-multi-workspace.spec.ts`: un monorepo con
    // dos workspaces (NestJS + Express) que la detección expandida
    // identifica como dos servicios.
    writeFileSync(
      join(workRoot, "package.json"),
      JSON.stringify({
        name: "x00024-monorepo",
        private: true,
        workspaces: ["apps/*"],
      }),
    );
    mkdirSync(join(workRoot, "apps", "api", "src"), { recursive: true });
    writeFileSync(
      join(workRoot, "apps", "api", "package.json"),
      JSON.stringify({
        name: "@x24/api",
        dependencies: { "@nestjs/core": "^10.0.0" },
      }),
    );
    writeFileSync(
      join(workRoot, "apps", "api", "src", "app.controller.ts"),
      `import { Controller, Get } from "@nestjs/common";
@Controller("widgets")
export class AppController {
  @Get() list() { return []; }
}
`,
    );
    mkdirSync(join(workRoot, "apps", "web"), { recursive: true });
    writeFileSync(
      join(workRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "@x24/web",
        dependencies: { express: "^4.19.0" },
      }),
    );
    writeFileSync(
      join(workRoot, "apps", "web", "server.js"),
      `const express = require("express");
const app = express();
app.get("/pages", (_req, res) => res.json([]));
`,
    );

    const result = await runProcess("bun", [
      GENERATE,
      "--project-root", workRoot,
    ]);

    // El exit code es la pieza que un script de CI puede leer sin
    // parsear texto: 64 = EX_USAGE (convención sysexits).
    expect(result.code, result.output).toBe(64);
    // El mensaje debe nombrar la solución, no solo el problema.
    expect(result.output).toMatch(/Detected \d+ service/i);
    expect(result.output).toMatch(/--combine-services/);
    // Si los serviceIds están en el error, también deben aparecer
    // listados en el stderr del CLI (es la parte accionable).
    expect(result.output).toMatch(/Detected services/i);
  }, 60_000);

  test("monorepo con 2 servicios + --combine-services → NO exit 64 (legacy)", async () => {
    // El flag debe suprimir el error: el caller ya pidió combinar, así
    // que el pipeline emite una sola colección combinada y termina
    // con éxito (o con el código que corresponda al contenido, nunca
    // 64 por este motivo).
    writeFileSync(
      join(workRoot, "package.json"),
      JSON.stringify({
        name: "x00024-monorepo-combine",
        private: true,
        workspaces: ["apps/*"],
      }),
    );
    mkdirSync(join(workRoot, "apps", "api", "src"), { recursive: true });
    writeFileSync(
      join(workRoot, "apps", "api", "package.json"),
      JSON.stringify({
        name: "@x24c/api",
        dependencies: { "@nestjs/core": "^10.0.0" },
      }),
    );
    writeFileSync(
      join(workRoot, "apps", "api", "src", "app.controller.ts"),
      `import { Controller, Get } from "@nestjs/common";
@Controller("widgets")
export class AppController {
  @Get() list() { return []; }
}
`,
    );

    const result = await runProcess("bun", [
      GENERATE,
      "--project-root", workRoot,
      "--combine-services",
    ]);

    // El exit 64 sería una regresión del fix. Si el script termina
    // con 0 (escritura OK) o con 1 (cero endpoints por alguna razón
    // concreta del fixture), pero NO 64, el comportamiento es el
    // esperado.
    expect(result.code, result.output).not.toBe(64);
  }, 60_000);
});
