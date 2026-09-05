import { describe, expect, test } from "vitest";

import { main } from "../../scripts/gates/lint-proposals.script";

describe("lint:proposals", () => {
  test("exit 0 en develop actual (frontmatter↔carpeta↔INDEX coherente, slices cerrados)", async () => {
    // Después de x00032 S1, las tres reglas nuevas están activas:
    //   1. todo `status: done` con `kind: !audit` debe tener todos sus
    //      slices en `**Status**: done` en el cuerpo.
    //   2. todo `status: done` debe llevar `shippedIn:` no vacío y los
    //      SHAs deben ser alcanzables en git.
    //   3. INDEX.md no lista `done` en Ready; todo `ready`/`blocked`
    //      aparece en su tabla.
    // El gate limpia 88 propuestas cerradas que no cumplían 1 o 2 en
    // el commit que activa la regla; desde entonces develop está verde.
    expect(await main()).toBe(0);
  });
});
