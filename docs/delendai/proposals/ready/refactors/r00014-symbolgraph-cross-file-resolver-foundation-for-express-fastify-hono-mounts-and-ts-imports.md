---
id: r00014
title: "SymbolGraph cross-file resolver — foundation for Express/Fastify/Hono mounts and TS imports"
kind: refactor
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-06
dependsOn:
  - x00048
---

# r00014 — SymbolGraph cross-file resolver

## Goal

Introducir un **modelo unificado de identidad de símbolos** que
permita a los scanners de Tanit resolver referencias entre
ficheros del mismo proyecto. La identidad se ancla a la posición
de declaración, no al nombre textual:

```ts
type SymbolId = {
  sourceFile: string;       // ruta absoluta o relativa al manifest root
  declarationStart: number; // offset 0-based dentro de sourceFile
  localName: string;        // nombre en el scope de declaración
};
```

Un `SymbolId` es estable mientras el proyecto no mute; dos `const
router = express.Router()` en ficheros distintos tienen IDs
distintos aunque compartan `localName === "router"`.

Este modelo es la **foundation** de tres propuestas que hoy están
bloqueadas o son half-done:

- **`x00055`** (Express router cross-file) — S1 ya implementa un
  `SymbolTable` ad-hoc por framework. S2 necesita un grafo
  compartido para resolver `import { router as usersRouter } from
  './users/routes'` y no chocar con el `router` local de
  `server.ts`.
- **`r00013`** (LanguageIR universal Fastify + Hono) — el camino
  hacia un AST compartido requiere resolver `fastify.register`
  cross-file, `app.route('/api', subApp)` y los imports TS que
  esos calls invocan. Sin grafo, sólo mismo-fichero.
- **`f00012`** (response inference) — la inferencia de tipo de
  retorno depende de poder seguir un símbolo desde el handler
  (`router.get('/x', handler)`) hasta su declaración
  (`function handler(req: Req): UserResponse {...}`) aunque vivan
  en ficheros distintos.

Sin r00014 las tres son **same-file only** y el producto se queda
en "API source discovery para proyectos pequeños". Con r00014 la
resolución cross-file sale del scope del scanner individual y se
convierte en una utilidad de Tanit.

## Why

Cuatro casos reales donde hoy Tanit falla o degrada silenciosamente
porque la identidad de símbolo es por nombre textual.

### 1. Express — `router` colisiona (la motivación de x00055)

```ts
// apps/users/src/routes.ts
export const router = express.Router();
router.get('/profile', getProfile);

// apps/orders/src/routes.ts
export const router = express.Router();
router.get('/list', listOrders);

// apps/server.ts
import { router as usersRouter } from './users/src/routes';
import { router as ordersRouter } from './orders/src/routes';
app.use('/users', usersRouter);
app.use('/orders', ordersRouter);
```

El scanner Express hoy guarda `Map<"router", prefix>`. La
segunda entrada (`/orders`) pisa la primera (`/users`); el
resultado es que las rutas de `users` aparecen bajo el prefijo
`/orders` en la colección Postman. **r00014 S4** consume el grafo
para resolver por `(sourceFile, declarationStart)`.

### 2. Fastify — `fastify.register` cross-file

```ts
// plugins/users.ts
export default async function usersPlugin(app: FastifyInstance) {
  app.get('/profile', getProfile);
}

// src/server.ts
import usersPlugin from './plugins/users';
fastify.register(usersPlugin, { prefix: '/users' });
```

Para que el scanner Fastify pueda atribuir `GET /profile` al
prefijo `/users`, debe poder decir "el símbolo `usersPlugin` que
veo en el call `fastify.register` es el export default del
fichero `./plugins/users.ts`". Hoy el scanner Fastify ignora
cross-file completamente.

### 3. Hono — `app.route('/api', sub)`

```ts
// src/api/v1.ts
export const v1 = new Hono();
v1.get('/health', (c) => c.json({ ok: true }));

// src/server.ts
import { v1 } from './api/v1';
const app = new Hono();
app.route('/api', v1);
```

Mismo patrón: el scanner tiene que seguir `v1` desde
`server.ts` hasta `api/v1.ts`. Sin grafo, no sabe que `GET
/api/health` existe.

### 4. TypeScript imports / re-exports

```ts
// src/services/user-service.ts
export interface User { id: string; name: string; }

// src/routes/users.ts
import { User } from '../services/user-service';
export function getUser(): User { ... }

// src/server.ts
import { router as usersRouter } from './routes/users';
app.use('/users', usersRouter);
```

El scanner necesita poder afirmar "el tipo `User` que aparece en
`getUser()` es el mismo símbolo que la `interface User` declarada
en `services/user-service.ts`". Esto es **independiente** del
framework; es un servicio genérico de Tanit.

## Non-goals

- **No es un type-checker completo.** No se valida que `User`
  realmente extienda otro tipo, ni se siguen tipos a través de
  generics. Sólo se resuelven **identidades de declaración**
  (variables, funciones, exports default, exports nombrados,
  imports).
- **No resuelve imports dinámicos.** `import('./foo')` con un
  argumento dinámico queda fuera; sólo `import { x } from '..'`
  estático.
- **No es un cache persistente.** El grafo se construye por
  scan. Si el proyecto muta, se reconstruye. No hay
  serialización a `.tanit/cache/symbols.json` en este slice.
- **No reemplaza el worktree aislado de los scanners.** Cada
  scanner sigue siendo responsable de detectar sus propios
  patrones (`Router()`, `fastify.register`, `app.route`). El
  grafo es **infraestructura de resolución**, no de detección.
- **No incluye cross-language.** Un backend donde un handler
  Python referencia un esquema definido en un fichero TS no
  entra. El grafo es per-lenguaje.

## Approach

### Modelo de datos

```ts
// packages/core/discovery/symbol-graph.ts

/** Identidad estable de un símbolo a través de un scan. */
export type SymbolId = {
  /** Ruta absoluta o relativa al manifest root del fichero de
   *  declaración. */
  sourceFile: string;
  /** Offset 0-based donde empieza la declaración. Estable mientras
   *  el fichero no mute entre dos scans. */
  declarationStart: number;
  /** Nombre local en el scope de declaración. Sirve para
   *  diagnóstico, NO para resolución. */
  localName: string;
};

/** Una declaración de símbolo, registrada en el grafo. */
export interface ISymbolNode {
  id: SymbolId;
  kind: "variable" | "function" | "class" | "interface"
      | "type" | "default-export" | "named-export";
  framework?: "express" | "fastify" | "hono" | "nestjs"
            | "fastapi" | "django" | "flask" | "spring"
            | "aspnet" | "laravel" | "symfony" | "gin"
            | "fiber" | "ktor" | "rails" | "phoenix"
            | "trpc" | "graphql" | undefined;
  /** Metadatos del scanner que descubrió el símbolo. El scanner
   *  puede leerlos después (p.ej. Express guarda `prefix` aquí). */
  metadata?: Readonly<Record<string, unknown>>;
}

/** Grafo per-scan, vive en `IScanResult.symbols`. */
export interface ISymbolGraph {
  /** Tabla sourceFile → SymbolIds declarados en ese fichero. */
  byFile: ReadonlyMap<string, ReadonlyArray<SymbolId>>;
  /** Tabla sourceFile → lista de imports declarados en ese
   *  fichero (ruta resuelta + nombre local + nombre importado). */
  imports: ReadonlyMap<string, ReadonlyArray<IImportRecord>>;
  /** Tabla SymbolId → ISymbolNode. */
  nodes: ReadonlyMap<SymbolId, ISymbolNode>;

  addSymbol(node: ISymbolNode): void;
  addImport(sourceFile: string, record: IImportRecord): void;

  /** Resuelve un símbolo por nombre local dentro del scope de un
   *  fichero. Si hay múltiples, devuelve todos — el caller decide
   *  qué hacer con la ambigüedad. */
  resolveByName(
    filePath: string,
    name: string
  ): ReadonlyArray<ISymbolNode>;

  /** Resuelve un símbolo siguiendo el path de import. */
  resolveByImportPath(
    filePath: string,
    importPath: string,
    name: string
  ): ReadonlyArray<ISymbolNode>;
}

/** Entrada mínima de import. */
export interface IImportRecord {
  /** Cómo se nombra localmente (`x` en `import { x as y } from
   *  './z'`). */
  localName: string;
  /** Cómo se llama en el módulo origen (`x` en el ejemplo de
   *  arriba). */
  importedName: string;
  /** Ruta tal como aparece en el código (`./z`). */
  specifier: string;
  /** Si es `import x from '...'` o `import * as x from '...'`,
   *  marca la diferencia respecto a named imports. */
  kind: "named" | "default" | "namespace";
}
```

### Encaje en `IScanResult`

```ts
// packages/core/discovery/scan-result.ts
export interface IScanResult {
  framework: string;
  routes: ReadonlyArray<ParsedRoute>;
  /** Símbolos descubiertos por este scanner. Vacío si el
   *  framework no emite ninguno. */
  symbols?: ISymbolGraph;
  // ... resto igual
}
```

### Resolución cross-file — el algoritmo

1. **S1** crea el grafo vacío al inicio del scanner.
2. **S1** lo puebla con TODAS las declaraciones que el scanner
   detecta en cada fichero (`const X = express.Router()`,
   `export const X = new Hono()`, `export default async function
   X(...)`, etc.).
3. **S2** puebla `imports` para cada fichero que el scanner
   recorre.
4. **S3** convierte `symbols?` en parte del contrato
   `IScanResult` (tipado, no breaking).
5. **S4** (Express) consume el grafo en `mountPrefixOf`: cuando
   ve `app.use('/x', router)` en `server.ts`, primero busca
   `router` en `resolveByName('server.ts', 'router')`. Si hay 0
   ó 2+, falla seguro (no emite prefijo). Si hay 1, busca en
   `resolveByImportPath('server.ts', './users/routes',
   'usersRouter')`. La resolución **termina en un SymbolId** y
   el prefijo se asocia a ese ID, no al nombre textual.

## Slices

### S1 — `SymbolGraph` core

- **Files**:
  - `packages/core/discovery/symbol-graph.ts` (nuevo)
  - `packages/core/discovery/symbol-id.ts` (nuevo, helper para
    construir/serializar `SymbolId`)
  - `packages/core/discovery/symbol-graph.spec.ts` (nuevo)
- **Gate**: `bun run test:core` + `bun run type` (strict)
- **Detalle**:
  - Implementa `SymbolId`, `ISymbolNode`, `ISymbolGraph`,
    `IImportRecord` exactamente como en la sección *Approach*.
  - `addSymbol(node)` valida que `node.id.sourceFile ===
    node.id.sourceFile` (sanity check, no path normalization
    todavía — eso es S2).
  - `resolveByName(filePath, name)` itera `byFile.get(filePath)`
    y filtra por `node.id.localName === name`.
  - `resolveByImportPath(filePath, importPath, name)` busca en
    `imports.get(filePath)` entradas con `specifier ===
    importPath` y `localName === name`, resuelve la ruta, y
    reusa `resolveByName` en el fichero destino.
  - Tests:
    - 2 symbols con mismo `localName` en ficheros distintos →
      `resolveByName` devuelve sólo el del fichero pedido.
    - addSymbol idempotente (mismo `SymbolId` dos veces no
      duplica el node).
    - resolveByImportPath con import no registrado → array
      vacío (no throw).

### S2 — `import-path` resolver

- **Files**:
  - `packages/core/discovery/import-resolver.ts` (nuevo)
  - `packages/core/discovery/import-resolver.spec.ts` (nuevo)
- **Gate**: `bun run test:core` + `bun run type`
- **Detalle**:
  - Función `resolveImportPath(fromFile, specifier,
    projectRoot): string` que normaliza `./foo`,
    `../bar/baz`, y rutas absolutas. Para path resolution
    puro (sin filesystem check), usa `node:path/posix` —
    no se intenta `existsSync` ni `realpath`.
  - Soporta extension fallback: si el specifier no tiene `.ts`,
    prueba `.ts`, `.tsx`, `.js`, `/index.ts`, `/index.js`.
    Si nada matchea, devuelve el specifier tal cual para que el
    caller decida.
  - `IImportRecord` se rellena al poblar el grafo desde código
    TS (esto lo hace cada scanner; S2 sólo da la utilidad de
    resolución).
  - Tests:
    - `./foo` desde `/a/b/c.ts` → `/a/b/foo`.
    - `../bar` desde `/a/b/c.ts` → `/a/bar`.
    - `./utils` (sin ext) → `/a/b/utils.ts` cuando existe
      `.ts`, si no `.js`, si no queda igual.
    - Empty path → devuelve `''` (no throw).

### S3 — scanner contract: `IScanResult.symbols`

- **Files**:
  - `packages/core/discovery/scan-result.ts`
  - `packages/core/discovery/scan-result.spec.ts` (test del
    contrato, sin comportamiento)
  - `packages/frameworks/scanners/express.scanner.ts`
    (sólo añadir `symbols: SymbolGraph.empty()` al return del
    `scan()`; comportamiento cross-file real es S4 y x00055 S2)
  - `packages/frameworks/scanners/fastify.scanner.ts` (idem)
  - `packages/frameworks/scanners/hono.scanner.ts` (idem)
- **Gate**: `bun run test:core` + `bun run test:frameworks` +
  `bun run lint:naming`
- **Detalle**:
  - `IScanResult` gana `symbols?: ISymbolGraph` (opcional,
    default = no graph; no breaking).
  - `SymbolGraph.empty()` factory explícito para que cada
    scanner declare "este framework todavía no emite grafo" sin
    que la ausencia del campo signifique "no emite".
  - Los 3 scanners JS/TS (Express, Fastify, Hono) inicializan el
    grafo vacío en su `scan()`. **No** empiezan a poblarlo
    todavía — eso es responsabilidad de cada scanner decidir en
    sus propios slices posteriores.
  - Naming: el helper de creación se llama `SymbolGraph.empty()`
    y vive en el mismo fichero `symbol-graph.ts`.
  - Test del contrato: `IScanResult` con `symbols: undefined`
    sigue siendo válido (verifica backwards compat).

### S4 — Express cross-file resolution (consume el grafo)

Este slice es **Express same-file S1** de `x00055`, re-expresado
en términos de `r00014`. Consume el SymbolGraph para resolver
`app.use('/x', router)`.

- **Files**:
  - `packages/frameworks/scanners/express.scanner.ts`
  - `packages/frameworks/scanners/express.symbol-table.ts`
    (reemplaza el SymbolTable ad-hoc de x00055 con calls al
    `SymbolGraph`)
  - `tests/frameworks/express-symbol-graph.spec.ts` (nuevo)
  - `tests/fixtures/express-multi-router/` (nuevo — el de
    `x00055 S3` se reutiliza tal cual cuando esté listo)
- **Gate**: `bun run test:frameworks` + `bun run lint:fixtures`
- **Detalle**:
  - Cuando el scanner Express encuentra `const X =
    express.Router()`, lo registra en el grafo vía
    `addSymbol` con `kind: "variable"`, `framework: "express"`,
    `metadata: { prefix: ... }`.
  - Cuando ve `app.use('/prefix', router)`:
    1. `resolveByName(currentFile, 'router')` → array de 0..N
       nodos en ese fichero.
    2. Si está vacío, NO emitir prefijo (fail-safe).
    3. Si hay 1, asociar el prefijo a su `SymbolId`.
    4. Si hay >1, log warn + NO emitir (ambigüedad = no
       detectar).
  - Tests:
    - 2 routers mismo nombre, ficheros distintos → cada uno con
      su prefijo (regression del bug de x00055).
    - `app.use` con router no declarado → no emite prefijo,
      log warn (no falla el scan).
    - El grafo del `IScanResult` tiene los 2 routers con IDs
      distintos verificables.

> **Relación con `x00055`**: este slice **sustituye** x00055
> S1+S2 (que es el SymbolTable ad-hoc + mountPrefixOf). x00055
> S3 (fixtures + e2e) se mantiene como propio de x00055 porque
> cubre un bug específico de Express. Cuando S4 cierre, x00055
> S1+S2 pueden marcarse `done` y los tests de x00055 migran a
> `tests/frameworks/express-symbol-graph.spec.ts`.

## Acceptance

- `bun run type` verde en `strict` mode (los nuevos tipos
  `SymbolId`, `ISymbolNode`, `ISymbolGraph` están exportados
  desde `@api-source-tanit/contracts`).
- `bun run test:core` verde con 100% de coverage en
  `symbol-graph.ts` y `import-resolver.ts` (S1 + S2).
- `bun run test:frameworks` verde con la fixture
  `express-multi-router` cubriendo el caso de regresión de
  x00055 (S4).
- `bun run lint:naming` verde (nuevos exports siguen la
  convención `I*` para interfaces, tipos `T*` o `*Id`).
- Tests cubren los 3 frameworks JS/TS en `IScanResult.symbols`:
  Express + Fastify + Hono (S3). Cada uno declara
  `SymbolGraph.empty()` en su `scan()` aunque no empiece a
  poblar.
- `bun run docs:sync` regenera el índice con la entrada de
  r00014 marcada `done` en `a00018 §Slices propuestos`.

## Risks

- **Coste de parsing TS.** Resolver imports requiere parsear
  cada `import { ... } from '...'` en cada fichero del
  proyecto. Si un proyecto tiene 500 ficheros TS y el scanner
  parsea cada uno para registrar imports, el scan crece
  linealmente. Mitigación: el parser se cachea por fichero
  (hash → AST) durante un scan; si el proyecto es más grande,
  el siguiente slice mide antes de añadir complexity.
- **Coste multi-pass.** Hoy los scanners son single-pass sobre
  cada fichero. Añadir el SymbolGraph obliga a una segunda
  pasada (poblar el grafo y luego resolver). Mitigación: S1+S2
  son O(n) en el número de declaraciones; sólo se nota en
  proyectos con miles de declaraciones TS por fichero, que es
  un outlier. Si el profiling muestra regresión, el siguiente
  slice introduce un scan paralelo con worker threads.
- **Naming colisión en tests.** El `SymbolGraph` vacío puede
  confundirse con "el scanner no implementó el grafo". El
  factory `SymbolGraph.empty()` y los tests de S3 (verificar
  que `symbols === empty()` y NO `undefined`) mitigan esto.
- **Coexistencia con `x00055` S1+S2.** El SymbolTable ad-hoc
  de x00055 y el `SymbolGraph` de r00014 colisionan si ambos
  viven. Mitigación: S4 los fusiona, los tests de x00055 S1+S2
  migran a S4, x00055 S1+S2 se marcan `done` con `reason:
  "subsumed by r00014 S4"`. x00055 S3 (fixtures + e2e) sigue
  propio.