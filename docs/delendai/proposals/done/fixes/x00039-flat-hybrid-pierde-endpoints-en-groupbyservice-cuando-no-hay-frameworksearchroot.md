---
id: x00039
kind: fix
title: "x00039: flat-hybrid pierde endpoints en groupByService cuando NO hay frameworkSearchRoot"
status: done
priority: P1
nonGoals:
  - Cambiar el contrato de IGroupByServiceInput.
  - Migrar el caller de toServiceGraph (lo hace S2 si hace falta).
  - Resolver el bridge TypeScript multi-estilo (`const M = "get"`).
  - Tocar filterSpecsForService o el merger.
globalGate: type
shippedIn:
  - 0223930  # chore: helper + tests + propuesta
  - dbb459d  # fix(x00039): flat-hybrid preserva endpoints en groupByService
why: |
  El auditor externo (revisión 2026-09-05) y la propia auditoría
  interna detectaron que `groupByService` en modo `flatHybrid` siempre
  devuelve `endpoints: []` aunque `routesByMatch` contenga las rutas
  correctas bajo las claves derivadas por framework.

  El bug es estructural: cuando NO hay `frameworkSearchRoot`,
  `serviceKeyOf(match)` resuelve a `normalizeServiceId(match.projectRoot)`,
  pero `routesByMatch` se hidrata aguas arriba por `deriveServiceId(match)`
  que cae a `<framework>@<projectRoot>`. La lookup falla por diseño.

  Repro mínimo:
    matches = [express("/repo"), graphql("/repo")]  // sin frameworkSearchRoot
    routesByMatch = Map { "express_repo" => [...], "graphql_repo" => [...] }
    → services[0].endpoints === []  // BUG; debería tener las rutas de ambos

  El propio comentario del código reconoce el problema ("this lookup
  misses by design") pero NO lo arregla: el merge posterior concatena
  `existing.endpoints + routes.filter(...)`, y como `routes = []`, el
  descriptor queda con cero endpoints.

  Impacto real: una API plana con `apps/api` que mezcla Express (REST)
  y GraphQL (POST /graphql) en el mismo repo termina con una colección
  Postman que contiene sólo el descriptor "Express + GraphQL" pero sin
  ninguna ruta. Silenciosamente roto.

  El test que faltaba en x00031 S2 es exactamente este: el único test
  que mezcla frameworks usa `frameworkSearchRoot: "apps/api"`, con lo
  que `flatHybrid === false` y el bug nunca se ejercita.

  Esta propuesta cierra ese hueco en un solo slice atómico:
    S1: test que reproduce + fix mínimo en group-by-service.helper.ts
acceptance:
  - Test E2E que prueba el caso `flatHybrid` puro (sin
    frameworkSearchRoot) con `routesByMatch` poblado por claves
    derivadas, y exige que `endpoints` contenga las rutas de ambos
    frameworks.
  - `bun run validate` verde.
  - `groupByService` documenta explícitamente cómo se localizan las
    rutas en modo flat-hybrid (no más "misses by design" sin solución).
slices:
  - sliceId: S1
    title: "fix(group-by-service): flat-hybrid preserva endpoints"
    files:
      - packages/core/discovery/group-by-service.helper.ts
      - tests/core/group-by-service.spec.ts
    gate: type
    dependsOn: []
    acceptance:
      - Test nuevo que reproduce el bug y falla antes del fix.
      - Helper `collectFlatHybridRoutes` interno que agrega las rutas
        de TODOS los frameworks que comparten `projectRoot` en flat-hybrid.
      - Lookup unificado: en flat-hybrid `routes` se calcula con el
        helper; en monorepo/wrapped, comportamiento previo intacto.
      - `bun run validate` verde (212+ tests, incluyendo el nuevo).
---

# x00039 — flat-hybrid pierde endpoints en `groupByService`

## Contexto

x00031 introdujo `IServiceDescriptor` con `additionalMatches` y `frameworks`
para soportar el caso híbrido (un servicio, varios frameworks) pero no
probó el escenario en el que el híbrido es **plano** (sin
`frameworkSearchRoot`). En ese modo:

- `flatHybrid === true`
- `serviceKeyOf(match)` devuelve `normalizeServiceId(match.projectRoot)`
- `routesByMatch` se hidrata con claves `<framework>@<projectRoot>`
  (porque `deriveServiceId` cae al fallback cuando no hay
  `frameworkSearchRoot`)
- El lookup `routesByMatch.get(serviceKeyOf(match))` siempre falla
- El merge posterior concatena con `routes = []`, así que `endpoints`
  queda vacío

El test que añadió x00031 S2 (`x00031 S2 acceptance #1`) usa
`frameworkSearchRoot: "apps/api"`, lo que evita `flatHybrid`. Por eso
el bug pasó.

## Repro

```typescript
const graph = groupByService({
  matches: [
    match("express", "/repo"),
    match("graphql", "/repo"),
  ],
  routesByMatch: new Map([
    ["express_repo", [route("GET", "/users")]],
    ["graphql_repo", [route("POST", "/graphql")]],
  ]),
});

// Actual (BUG):
// graph.services[0].endpoints === []
//
// Esperado:
// graph.services[0].endpoints.length === 2
// graph.services[0].frameworks === ["express", "graphql"]
```

## Fix

Helper local `collectFlatHybridRoutes` que agrega las rutas de todos
los matches cuyo `projectRoot` coincide y carecen de
`frameworkSearchRoot`:

```typescript
function collectFlatHybridRoutes(
  routesByMatch: ReadonlyMap<string, ReadonlyArray<ParsedRoute>>,
  match: IProjectMatch,
  allMatches: ReadonlyArray<IProjectMatch>,
): ParsedRoute[] {
  const out: ParsedRoute[] = [];
  const seen = new Set<string>();
  for (const m of allMatches) {
    if (m.projectRoot !== match.projectRoot) continue;
    if (m.frameworkSearchRoot !== undefined && m.frameworkSearchRoot !== "") continue;
    const derived = deriveServiceId(m);
    const routes = routesByMatch.get(derived) ?? [];
    for (const r of routes) {
      const key = `${r.method}|${r.uri}|${r.sourceFile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}
```

Y en el loop principal:

```typescript
const routes = flatHybrid
  ? collectFlatHybridRoutes(input.routesByMatch, match, input.matches)
  : input.routesByMatch.get(serviceId) ?? [];
```

El comentario engañoso ("misses by design") se reemplaza por uno que
documenta el comportamiento correcto.

## Riesgos

- Cambio local: solo `group-by-service.helper.ts` y su spec.
- Cero impacto en callers (la firma de `groupByService` no cambia).
- Tests existentes siguen pasando (cubren el camino no-flatHybrid).
- El test nuevo documenta el contrato para flat-hybrid.

## NO objetivos

- No se cambia `IGroupByServiceInput`.
- No se migra el caller de `toServiceGraph` (queda fuera de scope;
  si hace falta, será S2).
- No se toca el merger ni `filterSpecsForService`.
- No se reabre x00031; este fix es complementario y se cierra solo.
