---
id: r00007
title: "Un proyecto de contratos: ni una interfaz, tipo ni constante fuera de él"
kind: refactor
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
shippedIn:
  - 613f1fd  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

> **S1 entregada a 2026-08-08.** La sección existe y las seis anteriores
> dependen de ella. Salieron dos cosas que la propuesta no preveía:
>
> · **`core/contracts/postman.d.ts` no tenía nada de Postman.** Son 466
>   líneas de declaraciones ambient de `node:*` y de globals, el sustituto
>   escrito a mano de `@types/node`. Estaba en el sitio equivocado y con
>   el nombre equivocado: es el contrato más compartido del repo —lo
>   incluyen los cuatro tsconfig— viviendo dentro del núcleo. Ahora es
>   `packages/contracts/interfaces/runtime.d.ts`. Sin ese movimiento la
>   sección nueva no llegaba a tipar: era la única que no podía usar node.
>
> · **El test que decía «el núcleo no depende de nadie» decía otra cosa
>   de la que quería decir.** Lo que mantiene agnóstico a `core` es no
>   depender de `frameworks`, no no depender de nada. Reescrito como lo
>   que significa, para que la próxima sección nuclear no obligue a
>   tocarlo otra vez.
>
> **S2 entregada.** `packages/core/` ya no exporta **ni una** interfaz ni
> un tipo: 0 de 38. Los 8 ficheros de `core/contracts/` viven repartidos
> en `interfaces/core/` y `constants/core/`, y los 38 tipos sueltos están
> en tres ficheros por dominio —`discovery`, `domain`, `helpers`—.
>
> Tres cosas que la propuesta no preveía:
>
> · **`IGenerationOptions` no podía ser contrato tal cual.** Su firma
>   llevaba la clase `DiscoveryOrchestrator`. Ahora hay
>   `IDiscoveryOrchestrator` en contratos y la clase la implementa.
> · **El marcador de `findPackageRoot()` se quedó viejo por segunda vez**,
>   y esta vez lo cazaron los tests en el acto.
> · **`CORE_CONTRACTS_DIR`** en el registro de rutas del repo, sustituido
>   por `CONTRACTS_DIR` y sus dos subcarpetas.
>
> **S3 entregada.** `packages/frameworks/` tampoco exporta ya ningún
> tipo: los 15 están en `interfaces/frameworks/scanners.interface.ts`.
>
> Lo importante es la **inversión** del catálogo. `SUPPORTED_FRAMEWORKS`
> se derivaba de `DEFAULT_REGISTRY.detectors`, así que leer veintiún
> nombres obligaba a importar los veintiún scanners con sus parsers de
> PHP, Go, Java, Python y Rust detrás — y el plugin MCP lo hacía solo
> para declarar un `z.enum`. Ahora `FRAMEWORK_IDS` es una lista literal
> en `constants/frameworks/` y el registro expone
> `registeredFrameworkIds()`, que es **lo que cumple** del catálogo.
>
> El precio de invertirlo son dos listas, y este repositorio ya sabe cómo
> acaba eso: `NON_LARAVEL_FRAMEWORKS` enumeraba once de doce, Laravel no
> estaba, y `summary` decía 7 donde el pipeline encuentra 17. Lo que hacía
> peligrosa aquella lista no era existir: era que nadie la comparaba. Hay
> un test que las compara, verificado metiendo un id inventado.
>
> **S4 entregada.** `packages/cli/` y `packages/ui/` tampoco exportan ya
> ningún tipo. Los 15 están en `interfaces/cli/`, repartidos entre
> `command-outcomes.interface.ts` (lo que devuelve cada comando) y
> `ui.interface.ts` (lo que la interfaz declara).
>
> `ColorName` obligó a mover también la paleta ANSI: el tipo **es** la
> lista de códigos (`keyof typeof CODES`), así que separarlos habría
> dejado dos listas que se separan a la primera. Ahora `ANSI_CODES`,
> `DEFAULT_TERMINAL_WIDTH` y `DEFAULT_UI_PORT` viven en
> `constants/cli/terminal.constant.ts`.
>
> Y el test de autocontención tenía un falso positivo esperando: miraba
> si el import empezaba por `../..` en vez de resolver la ruta. En cuanto
> un contrato de `interfaces/cli/` importó uno de `constants/cli/` —que
> sigue dentro de contratos— saltó. Ahora resuelve. Un contrato puede
> apoyarse en otro; lo que no puede es apoyarse en una implementación.
>
> **S5 entregada.** Cuatro esquemas zod del plugin —`summary`, `check`,
> `stats` y `scan`— están **atados por tipo** a su contrato:
>
> ```ts
> const _summaryCubreElContrato: z.ZodType<{ ok: true } & IProjectSummary> =
>   SummaryOutputSchema;
> ```
>
> Añadir un campo al contrato y olvidarse del esquema deja de compilar.
> Verificado metiendo uno: falla en el sitio exacto. Es la divergencia
> que ya ocurrió —esquema con 6 campos, handler devolviendo 18— hecha
> imposible.
>
> Y salió el gemelo del catálogo de frameworks: `supportedFormats()` se
> derivaba de `TARGETS`, así que leer seis nombres costaba cargar los
> cinco exportadores. Ahora `EXPORT_FORMATS` es dato en contratos,
> `registeredFormats()` es lo que el registro cumple, y hay un test que
> los compara — verificado metiendo un formato inventado.
>
> Del plugin ya solo salen imports de **ejecución** (`runList`,
> `summarizeWithAllFrameworks`, `scannerBundleFor`) y el `withScopedPaths`
> que `lint:project-context` tiene declarado como deuda. Ni uno de tipo.
>
> **S6 entregada, y con ella la propuesta entera.** `lint:contracts`
> entra bloqueando: 158 tipos y constantes, todos en una carpeta de
> contratos, y **dos** excepciones declaradas con su motivo.
>
> Las dos excepciones son el matiz que la propuesta no había pensado:
> hay cosas que usan `const` y no son constantes. `UI_HTML` es la página
> entera de la interfaz web —un asset que el programa sirve tal cual— y
> `DEFAULT_REGISTRY` es un grafo de scanners ya instanciados, o sea una
> raíz de composición. Meter cualquiera de las dos en una sección que
> promete no tener implementación sería cumplir la letra rompiendo el
> motivo.
>
> El criterio queda escrito: algo es contrato cuando **más de un módulo
> depende de su valor o su forma concreta**.
>
> El gate falla de dos maneras, las dos verificadas metiendo el fallo: una
> declaración fuera de sitio, y una excepción que ya no hace falta.
>
> De paso destapó un test frágil: `generate-json-report.test.ts` sacaba
> `SUPPORTED_REPORT_VERSION` con una regex sobre el fichero del plugin.
> Al mudar la constante, el `exec` devolvió `undefined`, `Number()` lo
> convirtió en `NaN` y falló el test — no el contrato. Ahora importa el
> valor: un test que lee código como texto comprueba dónde está escrito
> algo, no cuánto vale.

# r00007 — Un proyecto de contratos: ni una interfaz, tipo ni constante fuera de él

## Goal

Que todo tipo, interfaz y constante del repositorio viva en un unico proyecto de contratos —`packages/contracts/`, con `interfaces/` y `constants/` dentro—, y que el resto de proyectos tire de ahi para reutilizar siempre el mismo tipado. Fuera de ese proyecto no queda ninguna interfaz, tipo ni constante exportada.

## why

Hoy los tipos viven pegados a la implementacion que los estreno: 82 interfaces y tipos exportados repartidos en 51 ficheros, mas 15 constantes en SCREAMING_CASE, todos fuera de las dos carpetas `contracts/` que existen. Y el reparto no es teorico, ya duele en tres sitios medidos: la UI importa `IProjectSummary` de `core/discovery/summary.service`, el plugin importa `SUPPORTED_FRAMEWORKS` de `frameworks/index` y `supportedFormats` de `core/exporters/export-registry.service`. Para usar un tipo compartido hay que alcanzar el fichero de implementacion que lo declara, arrastrando su modulo entero y sus dependencias.

Eso produce tres efectos concretos. Primero, tipado duplicado: `plugin.interface.ts` reescribe con zod la forma de `IProjectSummary` que ya existe en core, y las dos se separaron —el esquema declaraba 6 campos y el handler devolvia 18, que fue un bug real de esta ronda—. Segundo, imports que cruzan secciones por un tipo y arrastran runtime: importar `export-registry.service` solo para leer `supportedFormats()` mete el registro de exportadores entero en el grafo del plugin. Tercero, el propio autor de este cambio acaba de reincidir: `IScanOutcome` e `IStatsOutcome`, escritas hace diez minutos, nacieron dentro de `scan.script.ts` y `stats.script.ts`.

La regla tampoco esta escrita en ningun gate, asi que no hay nada que la sostenga. Las dos carpetas `contracts/` que si existen ademas no siguen la estructura pedida: guardan `*.interface.ts` y `*.constant.ts` sueltos, sin los subdirectorios `interfaces/` y `constants/`.

El gate va en el ultimo slice a proposito. Escribirlo primero obliga a un modo aviso con una lista de 97 excepciones que se va vaciando, y esa lista es exactamente la clase de fichero que se queda a medias. Poniendolo al final entra ya bloqueando y con cero excepciones.

## non-goals

- Publicar `packages/contracts/` como paquete npm aparte: es una seccion del monorepo, no una release
- Convertir en contrato compartido lo que es detalle interno de un modulo: un tipo privado no exportado se queda donde esta
- Tocar los tipos que vienen de dependencias externas (zod, @delendai/core): se reexportan, no se copian

## Slices

- global_gate: type

### S1 — La seccion `contracts` existe: tsconfig, vitest, fronteras y nadie por debajo
- **Status**: done
- **Files**: `scripts/gates/sections.constant.ts`, `tsconfig.contracts.json`, `vitest.config.ts`, `package.json`
- **Gate**: type
- acceptance:
  - "`packages/contracts/` es una seccion declarada en `sections.constant.ts` con `dependsOn: []` — la mas nuclear, nadie por debajo de ella"
  - "Las cinco secciones existentes la declaran en su `dependsOn`, y `lint:boundaries` sigue pasando"
  - "`tsc -p tsconfig.contracts.json` la tipa sola, sin arrastrar ninguna implementacion"
  - "`core` sigue sin poder importar de `frameworks`: la seccion nueva no relaja esa regla"

### S2 — El nucleo: sus 9 contratos adoptan la estructura y sus 21 tipos sueltos se mudan
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/contracts/interfaces/core/`, `packages/contracts/constants/core/`, `packages/core/`
- **Gate**: type
- acceptance:
  - "Los 9 ficheros de `packages/core/contracts/` viven repartidos en `interfaces/core/` y `constants/core/` segun lo que declaren, y esa carpeta desaparece"
  - "Las interfaces y tipos exportados de `core/helpers`, `core/domain`, `core/discovery`, `core/adapters` y `core/exporters` estan en el proyecto de contratos"
  - "Ningun fichero bajo `packages/core/` exporta ya una interfaz o un tipo"
  - "La suite de core pasa sin cambiar una sola asercion: es una mudanza, no un cambio de comportamiento"

### S3 — Frameworks: el catalogo deja de vivir dentro del registro que lo consume
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/contracts/interfaces/frameworks/`, `packages/contracts/constants/frameworks/`, `packages/frameworks/`
- **Gate**: type
- acceptance:
  - "`SUPPORTED_FRAMEWORKS` vive en `constants/frameworks/` y el registro lo consume, no al reves"
  - "Quien solo quiere el catalogo lo lee sin importar `frameworks/index`, que hoy arrastra los 21 scanners"
  - "Los tipos de parsers y scanners estan en contratos; sus implementaciones no exportan tipos"

### S4 — CLI y UI: los `Outcome` de cada comando son contrato, no detalle del script
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/contracts/interfaces/cli/`, `packages/cli/`, `packages/ui/`
- **Gate**: type
- acceptance:
  - "`IScanOutcome`, `IStatsOutcome`, `IListOutcome` y los de `generate` y `check` viven en contratos: son justo lo que consumen los tools del plugin"
  - "La UI deja de alcanzar `core/discovery/summary.service` para tipar su resumen"
  - "Ningun `*.script.ts` exporta interfaces ni tipos"

### S5 — El plugin deja de reescribir con zod lo que ya es un contrato
- **Status**: done
- **DependsOn**: [S2, S3, S4]
- **Files**: `packages/plugins/delendai_expostman/`
- **Gate**: type
- acceptance:
  - "Los esquemas zod se derivan de los contratos compartidos en vez de redeclarar su forma a mano"
  - "La divergencia que ya ocurrio —esquema con 6 campos, handler devolviendo 18— deja de compilar: un campo nuevo en el contrato rompe el typecheck del esquema"
  - "El plugin importa de `packages/contracts/`, no de `frameworks/index` ni de `core/exporters`"

### S6 — El gate que lo sostiene, y la regla escrita donde se lee
- **Status**: done
- **DependsOn**: [S2, S3, S4, S5]
- **Files**: `scripts/gates/lint-contracts.script.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`, `CONTRIBUTING.md`, `packages/contracts/README.md`
- **Gate**: lint
- acceptance:
  - "`lint:contracts` falla si aparece un `export interface`, `export type` o constante exportada fuera de `packages/contracts/`, y entra ya bloqueando con cero excepciones"
  - "El gate se verifica reintroduciendo una violacion a proposito: si no falla, no sirve"
  - "La regla esta en el bootstrap del proyecto y en CONTRIBUTING, no solo en el codigo del gate"
  - "`packages/contracts/README.md` explica que va en `interfaces/`, que en `constants/` y que no entra"

## acceptance

- `packages/contracts/` es una seccion declarada en `sections.constant.ts` con `dependsOn: []` — la mas nuclear, nadie por debajo de ella
- Las cinco secciones existentes la declaran en su `dependsOn`, y `lint:boundaries` sigue pasando
- `tsc -p tsconfig.contracts.json` la tipa sola, sin arrastrar ninguna implementacion
- `core` sigue sin poder importar de `frameworks`: la seccion nueva no relaja esa regla
- Los 9 ficheros de `packages/core/contracts/` viven repartidos en `interfaces/core/` y `constants/core/` segun lo que declaren, y esa carpeta desaparece
- Las interfaces y tipos exportados de `core/helpers`, `core/domain`, `core/discovery`, `core/adapters` y `core/exporters` estan en el proyecto de contratos
- Ningun fichero bajo `packages/core/` exporta ya una interfaz o un tipo
- La suite de core pasa sin cambiar una sola asercion: es una mudanza, no un cambio de comportamiento
- `SUPPORTED_FRAMEWORKS` vive en `constants/frameworks/` y el registro lo consume, no al reves
- Quien solo quiere el catalogo lo lee sin importar `frameworks/index`, que hoy arrastra los 21 scanners
- Los tipos de parsers y scanners estan en contratos; sus implementaciones no exportan tipos
- `IScanOutcome`, `IStatsOutcome`, `IListOutcome` y los de `generate` y `check` viven en contratos: son justo lo que consumen los tools del plugin
- La UI deja de alcanzar `core/discovery/summary.service` para tipar su resumen
- Ningun `*.script.ts` exporta interfaces ni tipos
- Los esquemas zod se derivan de los contratos compartidos en vez de redeclarar su forma a mano
- La divergencia que ya ocurrio —esquema con 6 campos, handler devolviendo 18— deja de compilar: un campo nuevo en el contrato rompe el typecheck del esquema
- El plugin importa de `packages/contracts/`, no de `frameworks/index` ni de `core/exporters`
- `lint:contracts` falla si aparece un `export interface`, `export type` o constante exportada fuera de `packages/contracts/`, y entra ya bloqueando con cero excepciones
- El gate se verifica reintroduciendo una violacion a proposito: si no falla, no sirve
- La regla esta en el bootstrap del proyecto y en CONTRIBUTING, no solo en el codigo del gate
- `packages/contracts/README.md` explica que va en `interfaces/`, que en `constants/` y que no entra
