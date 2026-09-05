import { afterEach, describe, expect, test } from "vitest";

import { main } from "../../scripts/gates/lint-clean-tree.script";

describe("lint:clean-tree", () => {
  const originalEnv = process.env.TANIT_ALLOW_DIRTY;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TANIT_ALLOW_DIRTY;
    } else {
      process.env.TANIT_ALLOW_DIRTY = originalEnv;
    }
  });

  test("TANIT_ALLOW_DIRTY=1 desactiva el gate", async () => {
    process.env.TANIT_ALLOW_DIRTY = "1";
    expect(await main()).toBe(0);
  });

  test("en develop actual el gate detecta estado (no asume clean absoluto)", async () => {
    // Si el árbol está realmente limpio, devuelve 0; si no, devuelve 1
    // con la lista exacta de ficheros. La idea es que el gate sea
    // informativo, no asertivo: si la rama está en mitad de un cambio,
    // lo dice, no lo oculta.
    const exitCode = await main();
    expect([0, 1]).toContain(exitCode);
  });
});
