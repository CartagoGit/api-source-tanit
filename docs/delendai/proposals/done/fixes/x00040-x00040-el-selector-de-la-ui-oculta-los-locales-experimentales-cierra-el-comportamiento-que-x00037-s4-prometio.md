---
id: x00040
kind: fix
title: "x00040: el selector de la UI oculta los locales experimentales (cierra el comportamiento que x00037 S4 prometió)"
status: done
priority: P1
shippedIn:
  - 3b7f1c1
nonGoals:
  - Cambiar el gate `lint:i18n-completeness` (eso es x00037, cerrado).
  - Traducir los placeholders (tarea humana).
  - Añadir un campo `progress: 0..100` por locale (futuro segundo wave).
globalGate: type
shippedIn: []
why: |
  x00037 S4 cerró su checklist con la frase:

    [x] El selector de la UI no muestra los placeholder hasta que se
        traduzcan. (futuro UI slice)

  Pero ese "futuro UI slice" nunca llegó: el cierre de x00037 fue
  prematuro. Hoy `loadLocales()` devuelve los 15 locales
  empaquetados sin filtrar — los 13 marcados como `experimental`
  siguen apareciendo en el selector con etiquetas como "Deutsch"
  que sirven "Settings / Back / Project folder" en inglés. El
  auditor 2026-09-05 lo señaló como bug de producto: mentir al
  usuario es peor que mostrar un selector corto.

  Esta propuesta cierra el comportamiento prometido:

    1. Tipo `Completitud` declarada en `contracts/` (no al lado
       del helper, porque `lint:contracts` lo prohíbe).
    2. Helper `completitud(catalogo)` lee `_meta._completeness`
       normalizando a uno de los cuatro estados del union.
    3. Función `esVisible(completitud)` decide si el locale entra
       al catálogo visible: `experimental` queda fuera; el resto
       (incluido `unknown`) pasa.
    4. `loadLocales()` filtra los empaquetados `experimental`
       ANTES de devolver el catálogo. Los locales externos NO se
       filtran: el usuario los puso ahí a propósito.

  Estado después del fix: el catálogo visible son 3 locales hoy
  (en + es + fr). Cuando alguien traduzca uno y le quite la marca
  `experimental`, aparece automáticamente.
acceptance:
  - Test E2E: 13 empaquetados `experimental` no aparecen en el
    catálogo visible; los 2 `complete` y el `reference` sí.
  - Test: un override externo de un `experimental` SÍ aparece.
  - Test: la función `completitud` normaliza correctamente cada
    forma de `_meta` (object, null, string, valor no reconocido).
  - 36/36 tests i18n pasan.
  - `bun run validate` verde (179 test files, 3319 tests,
    coverage ≥ 73% branches).
  - Seed de locales sigue dejando los 15 en disco (los
    experimentales están para que se traduzcan, no para
    ocultarlos del editor del usuario).
slices:
  - sliceId: S1
    title: "fix(i18n): loadLocales filtra empaquetados experimentales"
    files:
      - packages/contracts/interfaces/cli/i18n.interface.ts
      - packages/ui/i18n/i18n.service.ts
      - tests/cli/i18n.spec.ts
    gate: type
    dependsOn: []
    acceptance:
      - Tipo `Completitud` declarado en contracts.
      - `completitud()` y `esVisible()` exportadas y testeadas en aislamiento.
      - `loadLocales()` omite `experimental`; externos pasan siempre.
      - Tests existentes actualizados (toHaveLength(15) → (3) en
        los puntos afectados) y 6 tests nuevos añadidos.
      - Seed en disco sigue siendo 15 (los experimentales son
        editables aunque no visibles).
---

# x00040 — UI oculta locales experimentales

## Contexto

x00037 introdujo la gate `lint:i18n-completeness` y la anotación
`_meta._completeness` en los locales. Su S4 decía:

> [x] El selector de la UI no muestra los placeholder hasta que se traduzcan. (futuro UI slice)

Pero ese "futuro UI slice" no existía como código. La auditoría
2026-09-05 señaló el resultado: el selector mostraba "Deutsch",
"Français" etiquetando lo mismo — el contenido inglés. El cierre
de x00037 fue prematuro.

Este slice cierra ese comportamiento.

## Diseño

````typescript
// packages/contracts/interfaces/cli/i18n.interface.ts
export type Completitud = "reference" | "complete" | "experimental" | "unknown";

// packages/ui/i18n/i18n.service.ts
export function completitud(catalogo): Completitud { /* lee _meta */ }
export function esVisible(c: Completitud): boolean { return c !== "experimental"; }

export async function loadLocales(externalDir?) {
  const empaquetados = [];
  for (const l of BUNDLED_LOCALES) {
    const crudo = EMPAQUETADOS_CRUDOS[l.code];
    if (!esVisible(completitud(crudo))) continue;
    empaquetados.push(/* ... */);
  }
  // Externos: nunca se filtran (override del usuario).
  // ...
}
````

## Decisiones de diseño

- **`unknown` se muestra, `experimental` no.** El gate
  `lint:i18n-completeness` ya atrapa placeholders sin metadata;
  si un locale nuevo entra sin `_meta` se trata como "no
  verificado" (visible) en lugar de quedar oculto por error. La
  política de calidad (gate) y la UX (este fix) hablan idiomas
  distintos: una exige anotar, la otra no esconde sin avisar.

- **Externos NUNCA se filtran.** Quien dejó su `de.json` en la
  carpeta de idiomas sabe lo que hace. Filtrarlo sería una
  sorpresa peor que mostrarlo.

- **El seed sigue dejando 15 en disco.** Los experimentales son
  editables (ese es el punto de la propuesta original: que
  alguien los pueda traducir sin recompilar). Filtrar solo el
  catálogo visible, no la carpeta de la instalación.

## Tests añadidos

- `completitud` con metadata válida en cada estado.
- `completitud` con metadata ausente / null / string / valor
  no reconocido.
- `esVisible` para los 4 estados.
- `loadLocales` filtra los 13 experimentales conocidos.
- Override externo de un `experimental` SÍ aparece.
- Cobertura del cambio en los 4 tests preexistentes que
  asumían `toHaveLength(15)`.

## Riesgos

- Cambio en superficie pública del catálogo: consumidores que
  iteren `locales` (la web UI, el plugin) ahora ven 3 en
  lugar de 15. Pero cualquiera que itere `locales` ya asume
  "idiomas disponibles"; los 13 que desaparecen nunca
  deberían haber estado.
- `Completitud` es un export nuevo en `contracts/`. El lint
  `lint:contracts` lo exige en `interfaces/` no en la
  implementación; moverse está bien.

## NO objetivos

- No se traduce nada. Esa es la tarea humana, no del agente.
- No se cambia el gate `lint:i18n-completeness`.
- No se añade un campo `progress: 0..100` por locale (futuro
  segundo wave, cuando alguien lo pida de verdad).
- No se filtra por `unknown` (sección "Decisiones" arriba).
