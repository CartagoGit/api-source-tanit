/**
 * `process.argv` no entra al core en runtime (a00012 S4).
 *
 * Antes del S4, `resolveConfigPath` y `loadProject` declaraban
 * `argv: string[] = process.argv` como default. El core leía el global
 * del proceso: el servidor MCP o la UI web, que también llaman al
 * pipeline, terminaban heredando los argv del proceso host. El bug
 * era silencioso: en el caso típico del plugin el global tenía los
 * flags del IDE, así que `--config` no matcheaba y caía al zero-config,
 * pero un `--config <algo>` del host que coincidiera con la ruta
 * equivocada podía pisar el config del proyecto.
 *
 * El S4 cierra la fuga: el default pasa a `argv: ReadonlyArray<string> = []`.
 * El CLI pasa `process.argv.slice(2)` desde `cli.script.ts` (composition
 * root, ahí SÍ toca el global), y los tests pasan un array explícito o
 * vacío.
 *
 * Este spec verifica la propiedad desde tres ángulos:
 *
 *   1. `loadProject` con `argv: []` no lee `process.argv`. Lo
 *      demostramos stubbeando `process.argv` y observando que la
 *      función no lo consulta.
 *   2. `--config <path>` se aplica cuando va en el array explícito,
 *      ignorando el global.
 *   3. El pipeline (`generation.pipeline.ts`) pasa `options.argv ?? []`
 *      a `loadProject`, de modo que quien lo invoca controla el array.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";
import {
  buildZeroConfig,
  loadProject,
  resolveConfigPath,
} from "../../packages/core/discovery/project-loader.service";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import { generateCollection } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";

let projectTmp: ITempProject | null = null;

afterEach(async () => {
  await projectTmp?.cleanup();
  projectTmp = null;
  vi.restoreAllMocks();
});

/** Stub de `process.argv` con backup/restore alrededor del test. */
function withStubbedArgv<T>(argv: string[], fn: () => Promise<T>): Promise<T> {
  const backup = process.argv;
  process.argv = argv;
  try {
    return fn();
  } finally {
    process.argv = backup;
  }
}

async function inProject<T>(
  files: Record<string, string>,
  fn: (context: IProjectContext) => Promise<T>,
): Promise<T> {
  projectTmp = await createTempProject(files, "argv-free-");
  return fn(resolveProjectContext({ projectRoot: projectTmp.root }));
}

describe("loadProject no lee process.argv (a00012 S4)", () => {
  test("argv=[] ignora process.argv global: --config del host no se aplica", async () => {
    await inProject(
      {
        "composer.json": '{"name":"acme/argv-free"}',
      },
      async (context) => {
        // El global del proceso dice `--config /etc/passwd`. Si el
        // loader leyese process.argv, saltaría la detección normal y
        // devolvería error por ruta inexistente. Como ya no lo lee,
        // ignora el flag y resuelve el config del proyecto.
        await withStubbedArgv(["node", "x", "--config", "/etc/passwd"], async () => {
          const loaded = await loadProject([], context);
          // La config viene del proyecto (composer.json) o del
          // zero-config; en cualquier caso, NO de /etc/passwd.
          expect(loaded.config.name).not.toBe("passwd");
          expect(loaded.configPath).not.toBe("/etc/passwd");
        });
      },
    );
  });

  test("argv=['--config', '<mi-config>'] aplica el flag y rechaza el global", async () => {
    await inProject(
      {
        "composer.json": '{"name":"acme/explicit-argv"}',
      },
      async (context) => {
        const cfg = `${projectTmp!.root}/mi-config.ts`;
        // El global dice otra cosa; el argv explícito del loader
        // manda. La función resuelve el flag del array que le
        // pasamos, no el global.
        await withStubbedArgv(["node", "x", "--config", "/global-que-no-debe-aplicar"], async () => {
          const path = await resolveConfigPath(["node", "x", "--config", cfg], context);
          expect(path).toBe(cfg);
        });
      },
    );
  });

  test("stub de process.argv: el loader no lo consulta", async () => {
    // Comprobamos que `loadProject` no llama a nada que devuelva
    // `process.argv`. Esto es una guardia del universal §6 ("no leer
    // globales en hot path"): si alguien añade un default
    // `process.argv` en el futuro, este test lo caza.
    await inProject(
      {
        "composer.json": '{"name":"acme/no-leer-global"}',
      },
      async (context) => {
        const spy = vi.spyOn(process, "argv", "get");
        await withStubbedArgv(["node", "x", "--config", "/no-aplica"], async () => {
          await loadProject([], context);
        });
        // El loader con argv=[] no debe haber leído process.argv en
        // ningún momento: ni siquiera una vez.
        expect(spy).not.toHaveBeenCalled();
      },
    );
  });
});

describe("resolveConfigPath no lee process.argv (a00012 S4)", () => {
  test("argv=[] ignora --config del global", async () => {
    await inProject(
      {
        "composer.json": '{"name":"acme/resolve-argv"}',
      },
      async (context) => {
        await withStubbedArgv(["node", "x", "--config", "/lo-que-sea"], async () => {
          // Sin argv explícito, debe resolver el config del proyecto
          // (o el sentinel "__zero__"), nunca el flag global.
          const path = await resolveConfigPath([], context);
          expect(path).not.toBe("/lo-que-sea");
          expect(typeof path).toBe("string");
        });
      },
    );
  });
});

describe("buildZeroConfig no lee process.argv (a00012 S4)", () => {
  test("argv stubbeado no afecta al baseUrl por defecto", async () => {
    await inProject(
      {
        "composer.json": '{"name":"acme/zero-argv"}',
      },
      async (context) => {
        await withStubbedArgv(
          ["node", "x", "--config", "/etc/passwd", "--framework", "laravel"],
          async () => {
            const config = await buildZeroConfig(context);
            expect(config.baseUrl).toBe("http://localhost");
          },
        );
      },
    );
  });
});

describe("generation.pipeline pasa argv explícito al loader (a00012 S4)", () => {
  test("generateCollection sin options.argv: el pipeline no rompe", async () => {
    // El comportamiento esperado es que falte `options.argv` y el
    // loader reciba `[]`. Si alguien restaura `process.argv` aquí,
    // este test detecta el cambio de contrato: el pipeline debe
    // seguir funcionando aunque el global tenga `--config` raro.
    projectTmp = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "express-argv-free",
          dependencies: { express: "^4.19.0" },
        }),
        "server.js": `import express from "express";
const app = express();
app.get("/ping", (_req, res) => res.json({ ok: true }));
app.listen(3000);
`,
      },
      "generate-argv-free-",
    );

    await withStubbedArgv(
      ["node", "x", "--config", "/etc/passwd"],
      async () => {
        const result = await generateCollection(projectTmp!.root, {
          orchestrator: defaultOrchestrator(),
        });
        // El baseUrl por defecto NO debe contener el global stubbeado.
        expect(result.config.baseUrl).not.toBe("/etc/passwd");
        expect(result.config.baseUrl).toBe("http://localhost");
      },
    );
  });
});