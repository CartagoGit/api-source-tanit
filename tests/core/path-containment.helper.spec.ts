/**
 * Que una ruta de salida no se salga de donde debe.
 *
 * El CLI acepta `--output-dir` tal cual, y eso está bien cuando lo
 * escribe una persona en su propia máquina. Pero el plugin MCP spawnea
 * este mismo CLI con argumentos que vienen de un agente, y ahí quien
 * elige la ruta ya no es necesariamente la persona.
 *
 * Los dos fallos clásicos de esta comprobación están cubiertos abajo: el
 * enlace simbólico que apunta fuera, y el prefijo de cadena que parece
 * un padre sin serlo.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureInside } from "../../projects/core/helpers/path-containment.helper";

let base = "";
let raiz = "";

beforeEach(async () => {
  // `realpath` porque en macOS `/tmp` es un enlace a `/private/tmp`, y
  // entonces la raíz declarada y la resuelta no coincidirían nunca.
  base = await realpath(await mkdtemp(join(tmpdir(), "contain-")));
  raiz = join(base, "raiz");
  await mkdir(raiz, { recursive: true });
});

afterEach(async () => {
  if (base) await rm(base, { recursive: true, force: true });
});

describe("lo que está dentro", () => {
  test("la propia raíz", async () => {
    expect((await ensureInside(raiz, raiz)).ok).toBe(true);
  });

  test("una subcarpeta que existe", async () => {
    const sub = join(raiz, "salida");
    await mkdir(sub);
    expect((await ensureInside(raiz, sub)).ok).toBe(true);
  });

  /**
   * El caso normal: la carpeta de salida **todavía no existe**, se va a
   * crear. Si la comprobación exigiera que existiera, no valdría para
   * nada.
   */
  test("una subcarpeta que aún no existe", async () => {
    expect((await ensureInside(raiz, join(raiz, "no", "existe", "aun"))).ok).toBe(true);
  });

  test("una ruta relativa se resuelve contra la raíz", async () => {
    expect((await ensureInside(raiz, "salida")).ok).toBe(true);
  });

  test("devuelve la ruta ya resuelta, para escribir en esa", async () => {
    const r = await ensureInside(raiz, "salida");
    expect(r.resolved).toBe(join(raiz, "salida"));
  });
});

describe("lo que está fuera", () => {
  test("un `../` que se escapa", async () => {
    const r = await ensureInside(raiz, join(raiz, "..", "fuera"));
    expect(r.ok).toBe(false);
  });

  test("una ruta absoluta ajena", async () => {
    expect((await ensureInside(raiz, join(base, "otra"))).ok).toBe(false);
  });

  test("dice dónde se iba, no solo que no", async () => {
    const r = await ensureInside(raiz, join(raiz, "..", "fuera"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("fuera de");
  });

  /**
   * EL fallo clásico: comparar prefijos de cadena. `/base/raiz-mala`
   * empieza por `/base/raiz` y no está dentro de ella.
   */
  test("un hermano cuyo nombre empieza igual que la raíz", async () => {
    const hermano = join(base, "raiz-mala");
    await mkdir(hermano);
    expect((await ensureInside(raiz, hermano)).ok).toBe(false);
  });

  /**
   * El otro fallo clásico: un enlace **dentro** de la raíz que apunta
   * fuera. Sin resolver enlaces, esto pasa la comprobación y escribe
   * donde le da la gana.
   */
  test("un enlace simbólico dentro que apunta fuera", async () => {
    const fuera = join(base, "fuera");
    await mkdir(fuera);
    await writeFile(join(fuera, "marca.txt"), "x");
    const enlace = join(raiz, "puerta");
    await symlink(fuera, enlace);
    expect((await ensureInside(raiz, enlace)).ok).toBe(false);
    // Y tampoco a través de él.
    expect((await ensureInside(raiz, join(enlace, "dentro"))).ok).toBe(false);
  });
});
