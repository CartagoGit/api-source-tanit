---
id: x00055
title: "Express cross-file router identity — SymbolGraph (audit 2026-09-06 §4)"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-06
blockedReason: "Bloqueado en la práctica por r00014 (SymbolGraph cross-file). S2 solo resuelve dentro del mismo fichero; el caso cross-file (la motivación original de esta propuesta) necesita r00014 primero. Ver a00018 §6 (Lo que queda → 1. LanguageIR / 2. SymbolGraph)."
dependsOn:
  - x00038
  - x00048
  - r00014
---

# x00055 — `const router = express.Router()` en dos ficheros colisiona en el mapa global

## Goal

Que dos `const router = express.Router()` declarados en ficheros
distintos del mismo proyecto Express no se fusionen en el mismo
"router" lógico cuando el scanner mira los `app.use('/prefix',
router)`.

## Why (audit 2026-09-06 §4)

Cada scanner Express produce hoy:

```ts
const routerByVarName = new Map<string, string>();
// "router" → "/users"   o   "router" → "/orders"
```

Después `scan()` hace `app.use(prefix, router)` y busca el prefijo
exclusivamente por **nombre de variable**. El nombre no identifica
un símbolo globalmente. El ejemplo más común — un proyecto
modularizado con `apps/users/router.ts` + `apps/orders/router.ts`,
ambos `export const router = express.Router()` — produce:

```ts
routerByVarName = new Map([["router", "/users"]]);
// la segunda entrada ("router" → "/orders") pisa la primera
```

Y el prefijo `/orders` se aplica a las rutas de `users` cuando
`app.use('/orders', router)` se evalúa con el map contaminado.

Severidad: **P1 en proyectos Express modularizados**. El caso
típico de NestJS-mono-repo + Express-microservicio que es el
escenario multi-service que `a00013` resolvió a nivel de catálogo.

## Non-goals

- No migrar el scanner Express entero a LanguageIR (eso es
  `r00013`/`x00056`).
- No cambiar el contrato `ParsedRoute.framework`.

## Approach

Introducir un **SymbolGraph mínimo por framework** (no global,
solo lo que el scanner Express necesita para resolver mounts cross-
file). El grafo vive en el `IScanResult` y se consume durante la
fase de `mountPrefixOf`.

### Paso 1 — capturar el origen

Por cada `const X = express.Router()` que el scanner detecta,
guardar:

```ts
{
  name: string;             // "router"
  framework: "express";
  sourceFile: string;       // "apps/users/src/routes.ts"
  lineNumber: number;
  prefix?: string;          // si fue `Router({ prefix: "/api" })
  isDefault: boolean;       // export default vs named
  exportName?: string;      // "router" si named, undefined si default
}
```

### Paso 2 — resolver `app.use('/x', router)` por (sourceFile,
identidad) no por nombre

Cuando el scanner ve `app.use('/api', router)` en `server.ts`,
debe resolver `router` a la entrada del SymbolGraph **en el mismo
fichero** (`server.ts`) y, si no la encuentra, propagar la búsqueda
por imports explícitos (`import { router as usersRouter } from
'./users/routes'`).

### Paso 3 — fusionar prefijo por símbolo

El map de prefijos pasa de:

```ts
Map<variableName, prefix>
```

a:

```ts
Map<symbolId, prefix>
// symbolId = `${sourceFile}#${lineNumber}`
```

`app.use('/x', router)` resuelve `router` en el contexto de su
fichero y guarda la asociación `(symbolId → '/x')`. Dos `router`
en ficheros distintos tienen `symbolId` distintos y no colisionan.

## Slices

### S1 — `SymbolTable` mínimo para routers Express

- **Files**:
  - `packages/frameworks/scanners/express.symbol-table.ts` (nuevo)
  - `packages/frameworks/scanners/express.scanner.ts`
  - `tests/frameworks/express-symbol-table.spec.ts` (nuevo)
- **Gate**: `bun run test:frameworks` + `bun run lint:naming`
- **Detalle**:
  - Recorrer cada fichero Express detectado, encontrar TODAS las
    declaraciones `const X = express.Router()` / `const X =
    Router()` / `const X = Router({ prefix: '...' })` y poblar el
    SymbolTable.
  - El scanner guarda el SymbolTable en `IScanResult.symbols`
    para consumo posterior.
  - Tests: 2 routers con el mismo nombre en ficheros distintos →
    cada uno tiene su propio símbolo.
- review-state: in_review
- review-implementer: orchestrator-cartago-2026-09-07
### S2 — `mountPrefixOf` resuelve por símbolo, no por nombre

- **Files**:
  - `packages/frameworks/scanners/express.scanner.ts`
  - `tests/frameworks/express-scanner.spec.ts`
- **Gate**: `bun run test:frameworks`
- **Detalle**:
  - Cambiar `app.use('/prefix', router)` para resolver `router`
    en el contexto del fichero (mismo `sourceFile`), usando el
    SymbolTable de S1.
  - Si `router` no está en el SymbolTable del fichero, NO
    fusionar prefijos (mejor no detectar que detectar mal).
  - Tests: fixture nueva `tests/fixtures/express-multi-router`
    con 2 routers nombrados igual en 2 ficheros. Resultado:
    cada uno con su prefijo correcto.

### S3 — fixtures e2e multi-router

- **Files**:
  - `tests/fixtures/express-multi-router/package.json`
  - `tests/fixtures/express-multi-router/src/users.ts`
  - `tests/fixtures/express-multi-router/src/orders.ts`
  - `tests/fixtures/express-multi-router/src/server.ts`
  - `tests/e2e/express-multi-router.test.ts` (nuevo)
- **Gate**: `bun run test:e2e`
- **Detalle**:
  - Fixture completa (manifest + sources por router) para que
    `lint:fixtures` no se queje.
  - E2E: ejecuta el binario contra la fixture, valida que las
    rutas de cada router acaban en el prefijo correcto.

## Acceptance

`bun run validate` verde.

`bun test tests/e2e/express-multi-router.test.ts` verde con
cobertura del bug: los dos `router` no colisionan, los prefijos
son correctos, no hay rutas con prefijo cruzado.

`bun run lint:fixtures` sigue verde (la fixture nueva cumple).

## Risks

- S2 puede romper fixtures existentes si el SymbolTable se
  construye mal (p.ej. un `import { router } from './x'` no se
  sigue). Por eso S1 va primero con tests aislados, y S2 cambia
  el comportamiento solo si la resolución tiene éxito.
- Si S2 falla, el comportamiento de fallback debe ser NO emitir
  el prefijo (mejor incompleto que incorrecto).
