/**
 * `generate --json` — el contrato máquina del CLI.
 *
 * Es lo que consume el plugin de mcp-vertex. Antes no existía: el
 * plugin sacaba las rutas con expresiones regulares sobre el texto para
 * personas, y se rompió sin hacer ruido en cuanto ese texto pasó del
 * castellano al inglés. Estos tests fijan la forma para que la próxima
 * vez que alguien toque la salida legible, el gate lo diga.
 *
 * El invariante fuerte del modo `--json`: **stdout es exactamente un
 * documento JSON**. Si una traza se cuela por ahí, el consumidor se
 * come un error de parseo.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { moduleDir } from "../../helper/module-path.helper";
import { runProcess } from "../helpers/run-process";
import {
  GENERATE_REPORT_VERSION,
  type IGenerateReport,
} from "../../contract/generate-report.interface";

const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "../..");
const GENERATE = join(PACKAGE_ROOT, "scripts", "generate.script.ts");
const SOURCE_PROJECT = join(PACKAGE_ROOT, "examples", "example-express");

let project = "";
let stdout = "";
let stderr = "";
let report: IGenerateReport;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "postman-json-report-"));
  project = join(dir, "mi-api");
  await cp(SOURCE_PROJECT, project, { recursive: true });

  const result = await runProcess("bun", [GENERATE, "--project-root", project, "--json"], {
    cwd: PACKAGE_ROOT,
  });
  stdout = result.stdout;
  stderr = result.stderr;
  report = JSON.parse(stdout) as IGenerateReport;
}, 60_000);

afterAll(async () => {
  if (project) await rm(resolve(project, ".."), { recursive: true, force: true });
});

describe("generate --json", () => {
  test("stdout es exactamente un documento JSON", () => {
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  test("la traza legible se va a stderr, no contamina stdout", () => {
    expect(stderr).toContain("Collection written to");
    expect(stdout).not.toContain("Collection written to");
  });

  test("declara la versión del contrato", () => {
    expect(report.version).toBe(GENERATE_REPORT_VERSION);
    expect(report.ok).toBe(true);
  });

  test("trae el framework detectado y el nombre del proyecto", () => {
    expect(report.framework).toBe("express");
    expect(report.projectRoot).toBe(project);
  });

  // El fixture se copia a una carpeta temporal con OTRO nombre
  // (`mi-api`), y aun así el proyecto se identifica por lo que declara
  // su `package.json`. Es lo que queremos: mover o clonar el repo no
  // cambia la identidad de la colección, así que reimportar sigue
  // actualizando la que ya está en Postman en vez de duplicarla.
  test("el nombre sale del manifiesto, no de la carpeta", () => {
    expect(project.endsWith("mi-api")).toBe(true);
    expect(report.projectName).toBe("sample-express");
  });

  test("la colección que anuncia existe de verdad en disco", () => {
    expect(report.collectionPath).not.toBeNull();
    expect(existsSync(report.collectionPath!)).toBe(true);
  });

  test("los environments que anuncia existen de verdad en disco", () => {
    expect(report.environmentPaths.length).toBeGreaterThan(0);
    for (const path of report.environmentPaths) {
      expect(existsSync(path), path).toBe(true);
    }
  });

  test("el conteo de requests coincide con el del fixture", () => {
    // El ejemplo de express expone 9 endpoints en 3 carpetas.
    expect(report.requests).toBe(9);
    expect(report.folders).toBe(3);
  });

  test("el collectionId es el _postman_id, estable entre ejecuciones", async () => {
    const again = await runProcess(
      "bun",
      [GENERATE, "--project-root", project, "--json"],
      { cwd: PACKAGE_ROOT },
    );
    const second = JSON.parse(again.stdout) as IGenerateReport;
    expect(second.collectionId).toBe(report.collectionId);
    expect(report.collectionId).toMatch(/^[0-9a-f-]{36}$/);
  }, 60_000);

  test("informa del flujo de login detectado", () => {
    expect(report.auth).not.toBeNull();
    expect(report.auth?.loginEndpoint).toMatch(/POST/);
    expect(report.auth?.tokenVariable).toBe("token");
  });

  test("sin --json, stdout sigue siendo el texto para personas", async () => {
    const human = await runProcess("bun", [GENERATE, "--project-root", project], {
      cwd: PACKAGE_ROOT,
    });
    expect(human.stdout).toContain("Collection written to");
    expect(() => JSON.parse(human.stdout)).toThrow();
  }, 60_000);
});
