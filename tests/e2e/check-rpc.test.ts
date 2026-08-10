/**
 * `check` sobre una API de RPC sobre POST.
 *
 * `check` compara las rutas del código con las de la colección para
 * avisar de que se han desincronizado. Comparaba por **método + URI**, y
 * eso vale en REST porque la URL identifica la operación.
 *
 * En GraphQL no: hay **un** endpoint y lo que distingue una consulta de
 * otra es el nombre. Un proyecto de cinco operaciones se contaba como
 * una, y entonces `check` no podía detectar deriva **ninguna** — si
 * cuatro desaparecían del código seguía diciendo 1 contra 1 y dando el
 * visto bueno. La comprobación existía y no comprobaba nada.
 *
 * Es la tercera vez que la misma suposición muerde: ya pasó en el
 * `dedupeSpecs` del pipeline y en el chequeo de duplicados de los
 * invariantes.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_ENTRYPOINT, exampleDir } from "../../scripts/helpers/root.helper";
import { runProcess } from "../helpers/run-process";

let outDir = "";
let collection = "";
const project = exampleDir("graphql");

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "check-rpc-"));
  await runProcess("bun", [
    "run",
    CLI_ENTRYPOINT,
    "generate",
    "--project-root",
    project,
    "--output-dir",
    outDir,
  ]);
  collection = join(outDir, "sample-graphql.postman_collection.json");
}, 120_000);

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

async function check(): Promise<{ code: number; out: string }> {
  const result = await runProcess("bun", [
    "run",
    CLI_ENTRYPOINT,
    "check",
    "--project-root",
    project,
    "--output",
    collection,
  ]);
  return { code: result.code, out: result.output };
}

describe("check sobre GraphQL", () => {
  test("cuenta las 5 operaciones, no 1", { timeout: 120_000 }, async () => {
    const { out } = await check();
    expect(out).toMatch(/Routes en source:\s+5/);
    expect(out).toMatch(/Requests in collection:\s+5/);
  });

  test("una colección al día pasa", { timeout: 120_000 }, async () => {
    expect((await check()).code).toBe(0);
  });

  // EL test: sin él, `check` daba verde con la colección mutilada.
  test("detecta que falta una operación", { timeout: 120_000 }, async () => {
    const original = await readFile(collection, "utf8");
    try {
      const doc = JSON.parse(original) as {
        item: Array<{ item?: unknown[] }>;
      };
      const folder = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      folder!.item = folder!.item!.slice(1);
      await writeFile(collection, JSON.stringify(doc, null, 2));

      const { code, out } = await check();
      expect(code).toBe(1);
      expect(out).toContain("Missing from the collection");
    } finally {
      await writeFile(collection, original);
    }
  });

  test("dice CUÁL falta, no solo cuántas", { timeout: 120_000 }, async () => {
    const original = await readFile(collection, "utf8");
    try {
      const doc = JSON.parse(original) as { item: Array<{ item?: unknown[] }> };
      const folder = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      folder!.item = folder!.item!.slice(1);
      await writeFile(collection, JSON.stringify(doc, null, 2));

      // Tres `POST /graphql` iguales no dicen nada: hace falta el nombre
      // de la operación para saber qué buscar.
      const { out } = await check();
      expect(out).toMatch(/\((query|mutation) \w+\)/);
    } finally {
      await writeFile(collection, original);
    }
  });

  test("la URI no sale con doble barra", { timeout: 120_000 }, async () => {
    const original = await readFile(collection, "utf8");
    try {
      const doc = JSON.parse(original) as { item: Array<{ item?: unknown[] }> };
      const folder = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      folder!.item = folder!.item!.slice(1);
      await writeFile(collection, JSON.stringify(doc, null, 2));

      expect((await check()).out).not.toContain("//graphql");
    } finally {
      await writeFile(collection, original);
    }
  });
});
