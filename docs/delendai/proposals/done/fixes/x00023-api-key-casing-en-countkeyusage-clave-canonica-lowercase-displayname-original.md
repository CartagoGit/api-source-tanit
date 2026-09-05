---
id: x00023
title: "API key casing en countKeyUsage — clave canónica lowercase + displayName original"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - 3f6b533  # fix(core): x00023 API key casing en countKeyUsage — clave canónica lowercase + displayName
dependsOn: []
related:
  - a00009
  - x00022
shippedIn:
  - c566050  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# x00023 — API key casing en `countKeyUsage`

## Goal

Corregir `countKeyUsage()` en `packages/core/domain/auth-scheme.service.ts:62-79`
para que `X-API-Key` y `x-api-key` se cuenten bajo la misma entrada.
La API-key detection se vuelve a evaluar contra la suma agregada, no
contra el primer header que gane el `>` tie-break.

## Why

Hallazgo P1 del audit 2026-09-04 (snapshot `7ea3a5d`). El código actual:

```ts
for (const h of spec.headers ?? []) {
  const key = h.key.toLowerCase(); // lowercase para la comprobación
  if (API_KEY_HEADERS.has(key)) header.set(h.key, (header.get(h.key) ?? 0) + 1);
  //                                                  ^^^^^^^^^^^^^^^^^^^^
  //                                                  pero guarda con case original
}
```

Resultado: si el endpoint A declara `X-API-Key` y el endpoint B declara
`x-api-key`, el `Map` termina con dos entradas:

```
X-API-Key → 1
x-api-key → 1
```

El threshold (`>= 2` para confirmar API-key auth) no se alcanza y el
detector concluye "no API key", cuando debería contar 2.

## Non-goals

- No cambia el formato del `IEndpointAuth` resultante.
- No introduce normalización case-insensitive en todo el pipeline
  (eso es un fix de headers deduplication mayor).
- No relaja el threshold de 2.

## Slices

### S1 — fix + test de regresión

- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **Files**:
  - `packages/core/domain/auth-scheme.service.ts` (modifica `countKeyUsage`)
  - `tests/core/auth-scheme.service.spec.ts` (añade 3 tests nuevos)
- **Gate**: `bun run test:core tests/core/auth-scheme.service.spec.ts`
- **Detalle**:
  - Cambiar `header.set(h.key, ...)` por
    `header.set(key, (header.get(key) ?? 0) + 1)` — clave canónica
    lowercase.
  - Conservar aparte un `displayName` por clave canónica: el primer
    header original que se vio se queda como nombre visible (por
    defecto, mayúsculas).
  - El consumidor (la función que decide si activar API-key auth) lee
    `count >= 2` sobre la entrada agregada.
  - **3 tests nuevos** en `auth-scheme.service.spec.ts`:
    1. `[X-API-Key, x-api-key]` cuenta 2 bajo `x-api-key`, displayName `X-API-Key`.
    2. `[x-api-key, X-API-KEY, X-Api-Key]` cuenta 3 (todos mergean en una entrada).
    3. Threshold: con 2 endpoints y case mixto, el detector confirma API-key auth
       (antes fallaba).
  - Regresión cero: el test preexistente de case consistente sigue pasando.

### S2 — normalizar igual la ruta `query` params

- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **Files**: `packages/core/domain/auth-scheme.service.ts`
- **Gate**: `bun run test:core tests/core/auth-scheme.service.spec.ts`
- **Detalle**: aplicar el mismo patrón al `Map` de query params (mismo bug,
  misma solución). 1 test adicional.

## acceptance

1. `bun run test:core tests/core/auth-scheme.service.spec.ts` verde con
   los 3 tests nuevos (S1) + 1 test nuevo (S2) pasando.
2. Threshold de API-key funciona correctamente con case mixto.
3. `bun run validate` verde end-to-end.
4. Coverage sin regresión local.
