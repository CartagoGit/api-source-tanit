/**
 * Precedencia del directorio de salida en el helper sin estado.
 *
 * Antes estas reglas vivían dentro de `paths.service.outputDir(context?)`
 * (singleton retirado en r00010 S2, 2026-09-03), mezcladas con la caché
 * del singleton y con `process.argv` / `process.env` leídos directamente.
 * Aquí se prueban en aislamiento: con un contexto fabricado, sin tocar
 * el proceso.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";

import {
  describeDiscoveredPaths,
  outputCollectionPath,
  outputEnvironmentPath,
  resolveOutputDir,
} from "../../packages/core/discovery/output-paths.helper";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";

/** Contexto prefabricado para no ensuciar el spec con `resolveProjectContext`. */
function makeContext(overrides: Partial<IProjectContext> = {}): IProjectContext {
  return {
    projectRoot: "/tmp/proyecto",
    packageRoot: "/tmp/paquete",
    projectBasename: "proyecto",
    outputDir: "/tmp/proyecto/export-to-postman",
    ...overrides,
  };
}

describe("resolveOutputDir — precedencia", () => {
  test("--output-dir en argv gana sobre el contexto", () => {
    expect(
      resolveOutputDir(
        makeContext({ outputDir: "/tmp/contexto" }),
        ["--output-dir", "/tmp/cli-dir"],
      ),
    ).toBe("/tmp/cli-dir");
  });

  test("--output en argv devuelve el dirname del fichero", () => {
    expect(
      resolveOutputDir(makeContext(), ["--output", "/tmp/con-archivo/x.json"]),
    ).toBe(sep === "/" ? "/tmp/con-archivo" : "\\tmp\\con-archivo");
  });

  test("env POSTMAN_OUTPUT_DIR gana cuando no hay flag", () => {
    expect(
      resolveOutputDir(
        makeContext({ outputDir: "/tmp/contexto" }),
        [],
        { POSTMAN_OUTPUT_DIR: "/tmp/env-dir" },
      ),
    ).toBe("/tmp/env-dir");
  });

  test("CLI tiene prioridad sobre env", () => {
    expect(
      resolveOutputDir(
        makeContext({ outputDir: "/tmp/contexto" }),
        ["--output-dir", "/tmp/cli-dir"],
        { POSTMAN_OUTPUT_DIR: "/tmp/env-dir" },
      ),
    ).toBe("/tmp/cli-dir");
  });

  test("sin flag ni env, cae al context.outputDir", () => {
    expect(resolveOutputDir(makeContext({ outputDir: "/tmp/contexto" }), [], {})).toBe(
      "/tmp/contexto",
    );
  });

  test("sin contexto, sin flag ni env: lanza con mensaje accionable", () => {
    expect(() => resolveOutputDir(undefined, [], {})).toThrow(
      /output-dir|POSTMAN_OUTPUT_DIR|project-root/,
    );
  });

  test("sin contexto, con --output-dir en argv: funciona", () => {
    expect(resolveOutputDir(undefined, ["--output-dir", "/tmp/cli-dir"], {})).toBe(
      "/tmp/cli-dir",
    );
  });

  /**
   * `--output-dir --json` (sin valor) NO debe leerse como si el valor
   * fuera `--json`. Sin la comprobación de `!value.startsWith("--")`,
   * el flag siguiente se llevaba por delante y la carpeta se llamaba
   * literalmente `--json` en disco.
   */
  test("--output-dir sin valor no se come el flag siguiente", () => {
    expect(resolveOutputDir(makeContext({ outputDir: "/tmp/fallback" }), ["--output-dir", "--json"], {})).toBe(
      "/tmp/fallback",
    );
  });

  test("--output sin valor no se come el flag siguiente", () => {
    expect(
      resolveOutputDir(
        makeContext({ outputDir: "/tmp/fallback" }),
        ["--output", "--json"],
        {},
      ),
    ).toBe("/tmp/fallback");
  });
});

describe("outputCollectionPath — composición de la ruta", () => {
  let work: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "output-paths-helper-"));
  });
  afterEach(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  test("une outputDir + basename + .json", async () => {
    const out = work;
    const path = await outputCollectionPath(makeContext({ outputDir: out }), "mi-api", [], {});
    expect(path).toBe(join(out, "mi-api.postman_collection.json"));
  });

  test("sin projectName usa el projectBasename del contexto", async () => {
    const out = work;
    const path = await outputCollectionPath(makeContext({ outputDir: out, projectBasename: "api" }), undefined, [], {});
    expect(path).toBe(join(out, "api.postman_collection.json"));
  });

  test("la ruta por defecto cae en <projectRoot>/export-to-postman/", () => {
    // El contexto que construye `resolveProjectContext` deja
    // outputDir = `<raíz>/export-to-postman` cuando no se pasa `--output-dir`.
    // Aquí lo fabricamos a mano para fijar el comportamiento esperado.
    const ctx: IProjectContext = {
      projectRoot: "/tmp/proyecto",
      packageRoot: "/tmp/paquete",
      projectBasename: "proyecto",
      outputDir: "/tmp/proyecto/" + OUTPUT_DIR_NAME,
    };
    expect(resolveOutputDir(ctx, [], {})).toBe("/tmp/proyecto/" + OUTPUT_DIR_NAME);
  });

  test("respeta --output-dir por encima del contexto", async () => {
    const ctx = makeContext({ outputDir: "/tmp/contexto" });
    const argv = ["--output-dir", work];
    const path = await outputCollectionPath(ctx, "x", argv, {});
    expect(path).toBe(join(work, "x.postman_collection.json"));
  });
});

describe("outputEnvironmentPath — slug del environment", () => {
  let work: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "output-paths-helper-"));
  });
  afterEach(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  test("slugifica el nombre del environment a kebab-case", async () => {
    const path = await outputEnvironmentPath(makeContext({ outputDir: work }), "Local");
    expect(path).toMatch(/local\.postman_environment\.json$/);
  });

  test("elimina acentos y otros diacríticos", async () => {
    const path = await outputEnvironmentPath(makeContext({ outputDir: work }), "Producción Local");
    expect(path).toMatch(/produccion-local\.postman_environment\.json$/);
  });

  test("reemplaza caracteres no alfanuméricos por guiones", async () => {
    const path = await outputEnvironmentPath(makeContext({ outputDir: work }), "Stage_2 (QA)!");
    expect(path).toMatch(/stage-2-qa\.postman_environment\.json$/);
  });

  test("usa el projectBasename del contexto cuando no se pasa projectName", async () => {
    const path = await outputEnvironmentPath(
      makeContext({ outputDir: work, projectBasename: "my-app" }),
      "Dev",
    );
    expect(path).toMatch(/my-app\.dev\.postman_environment\.json$/);
  });

  test("no duplica el sufijo .postman_collection al construir el basename", async () => {
    const path = await outputEnvironmentPath(makeContext({ outputDir: work }), "Local");
    expect(path).not.toMatch(/\.postman_collection\.local\.postman_environment\.json$/);
  });
});

describe("describeDiscoveredPaths — la traza no miente", () => {
  /**
   * Sin projectName la traza dice `<nombre-del-proyecto>`, no se
   * inventa el nombre del directorio. Es el mismo contrato que
   * `describeDiscoveredPaths` ya tenía en el singleton retirado de
   * `paths.service` (r00010 S2, 2026-09-03); lo que cambia es que aquí
   * lo cumple un helper sin estado.
   */
  test("sin nombre de proyecto dice que aún no lo sabe", () => {
    const traza = describeDiscoveredPaths(makeContext({ projectBasename: "carpeta-ajena" }), undefined, []);
    expect(traza).toContain("<nombre-del-proyecto>");
    expect(traza).not.toContain("carpeta-ajena.postman_collection");
  });

  test("con projectName anuncia exactamente el fichero que se va a escribir", () => {
    const traza = describeDiscoveredPaths(makeContext(), "mi-api", []);
    expect(traza).toContain("mi-api.postman_collection.json");
  });

  test("lista el projectRoot y el outputDir resueltos", () => {
    const traza = describeDiscoveredPaths(
      makeContext({
        projectRoot: "/tmp/mi-api",
        outputDir: "/tmp/salida",
      }),
      undefined,
      [],
    );
    expect(traza).toContain("/tmp/mi-api");
    expect(traza).toContain("/tmp/salida");
  });
});
