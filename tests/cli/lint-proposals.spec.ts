import { describe, expect, test } from "vitest";

import { isReachableSha, main } from "../../scripts/gates/lint-proposals.script";

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

// Cubre el endurecimiento de la regla 7: un SHA que existe como
// objeto git pero NO es ancestro de HEAD (commit huérfano, rama
// abandonada) debe fallar `isReachableSha`, porque sólo se exige
// `cat-file -e` no distingue "está en el historial" de "alguien
// lo escribió alguna vez". El SHAs de las propuestas reales se
// siguen comprobando en el test de arriba, que carga `main()`.
describe("isReachableSha", () => {
  test("SHA huérfano (existe pero no es ancestro de HEAD) falla", async () => {
    // fab4996 es un commit real y alcanzable por `git cat-file -e`,
    // pero vive en una rama abandonada: NO es ancestro de HEAD. Era
    // exactamente el caso que el lint sólo con `cat-file` dejaba
    // pasar (el `shippedIn` fantasma).
    expect(await isReachableSha("fab4996")).toBe(false);
  });

  test("SHA inexistente como objeto git falla", async () => {
    expect(await isReachableSha("0000000")).toBe(false);
  });
});
