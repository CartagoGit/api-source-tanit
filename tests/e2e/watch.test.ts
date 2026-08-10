/**
 * El modo watch, de verdad: se toca un fichero y se regenera.
 *
 * Los tests de `watcher.service.spec.ts` cubren las piezas por separado.
 * Este comprueba lo único que no se puede comprobar con dobles: que
 * `fs.watch` recursivo llega, que el cambio dispara, y —sobre todo— que
 * **escribir la colección no vuelve a disparar el watcher**. Esa
 * retroalimentación es un bucle infinito, y solo se ve ejecutándolo.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { watchProject } from "../../projects/core/domain/watcher.service";
import { OUTPUT_DIR_NAME } from "../../projects/contracts/constants/core/postman.constant";
import type { IWatchHandle } from "../../projects/contracts/interfaces/core/domain.interface.js";

let root = "";
let handle: IWatchHandle | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "expostman-watch-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, OUTPUT_DIR_NAME), { recursive: true });
});

afterEach(async () => {
  handle?.close();
  handle = null;
  if (root) await rm(root, { recursive: true, force: true });
});

/** Espera a que `check` sea cierto, o se rinde. */
async function waitFor(check: () => boolean, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise<void>((r) => setTimeout(r, 25));
  }
  return check();
}

describe("watchProject", () => {
  test("un cambio en un fichero fuente dispara onChange", { timeout: 15_000 }, async () => {
    const batches: string[][] = [];
    handle = watchProject({
      root,
      debounceMs: 50,
      onChange: (changed) => {
        batches.push([...changed]);
      },
    });

    await writeFile(join(root, "src", "users.route.ts"), "export const x = 1;\n");
    const fired = await waitFor(() => batches.length > 0);

    expect(fired, "el watcher no reaccionó al cambio").toBe(true);
    expect(batches[0]?.some((p) => p.includes("users.route.ts"))).toBe(true);
  });

  /**
   * El test que justifica todo el cuidado del servicio.
   *
   * Se escribe en la carpeta de salida, que está DENTRO de la raíz
   * vigilada — igual que hace la herramienta al generar. Si el watcher
   * reaccionara, cada generación provocaría la siguiente y el proceso no
   * pararía nunca.
   */
  test(
    "escribir en la carpeta de salida NO dispara nada",
    { timeout: 15_000 },
    async () => {
      let calls = 0;
      handle = watchProject({
        root,
        debounceMs: 50,
        onChange: () => {
          calls++;
        },
      });

      for (let i = 0; i < 3; i++) {
        await writeFile(
          join(root, OUTPUT_DIR_NAME, `api.postman_collection.json`),
          JSON.stringify({ intento: i }),
        );
      }
      // Margen de sobra para que cualquier evento hubiera llegado.
      await new Promise<void>((r) => setTimeout(r, 600));

      expect(calls, "el watcher se disparó con su propia escritura").toBe(0);
    },
  );

  test("varios guardados seguidos producen un solo onChange", { timeout: 15_000 }, async () => {
    let calls = 0;
    handle = watchProject({
      root,
      debounceMs: 200,
      onChange: () => {
        calls++;
      },
    });

    for (let i = 0; i < 5; i++) {
      await writeFile(join(root, "src", `r${i}.ts`), `export const x = ${i};\n`);
    }
    await waitFor(() => calls > 0);
    await new Promise<void>((r) => setTimeout(r, 400));

    expect(calls).toBe(1);
  });

  test("close() deja de vigilar", { timeout: 15_000 }, async () => {
    let calls = 0;
    handle = watchProject({
      root,
      debounceMs: 50,
      onChange: () => {
        calls++;
      },
    });
    handle.close();
    handle = null;

    await writeFile(join(root, "src", "tarde.ts"), "export const x = 1;\n");
    await new Promise<void>((r) => setTimeout(r, 400));

    expect(calls).toBe(0);
  });

  test("node_modules no despierta al watcher", { timeout: 15_000 }, async () => {
    let calls = 0;
    handle = watchProject({
      root,
      debounceMs: 50,
      onChange: () => {
        calls++;
      },
    });

    await mkdir(join(root, "node_modules", "algo"), { recursive: true });
    await writeFile(join(root, "node_modules", "algo", "index.js"), "module.exports = {};\n");
    await new Promise<void>((r) => setTimeout(r, 500));

    expect(calls).toBe(0);
  });
});
