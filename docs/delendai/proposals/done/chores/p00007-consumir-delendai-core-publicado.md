---
id: p00007
title: "p00007 — consumir `@delendai/core` publicado en vez del enlace local"
kind: chore
status: done
type: proposal
track: export-to-postman
date: 2026-07-31
revised: 2026-09-03
closed: 2026-09-03
related:
    - p00008 # publicar este paquete tiene el mismo tipo de bloqueo operacional
---

> **Cerrada 2026-09-03 — decisión del proyecto.** Hasta que
> `@delendai/core` se publique como versión semver en npm,
> **se consumirá el repo hermano por enlace `file:` desde local** como
> flujo oficial y soportado. La propuesta se reactiva el día que
> `npm view @delendai/core version` deje de devolver 404: ese día
> S1 es literalmente una línea (`file:...` → `^<versión>`) y se
> reorienta como `ready`.

# p00007 — consumir `@delendai/core` publicado en vez del enlace local

## Goal original

Cambiar la dependencia del plugin:

```diff
- "@delendai/core": "file:../../../delendai/packages/core"
+ "@delendai/core": "^<versión publicada>"
```

para que `packages/plugins/delendai_expostman/` no dependa de que el repositorio
`delendai` esté clonado como hermano de este.

## Decisión 2026-09-03

El flujo `file:` se **admite como forma oficial** mientras el paquete
no esté publicado:

- Es el mismo patrón que `delendai` recomienda en su propia
  `UNIVERSAL-AGENT-BOOTSTRAP.md` para prerelease local.
- El plugin es `"private": true` y no viaja en el `tarball`: la
  dependencia `file:` es local del repo, no rompe el producto
  distribuible a terceros.
- Publicar `@delendai/core` está **bloqueado externamente** por
  credenciales, no por este repositorio.

Por tanto, **no hay nada que hacer aquí hasta que npm devuelva una
versión real**. Esta propuesta queda `done` por cambio de política,
no por implementación de los slices originales.

## Cuándo se reabre (futuro)

`npm view @delendai/core version` deja de devolver 404. En ese
momento se reabre como `ready`:

1. Cambiar el `file:` por `^<versión>` en
   `packages/plugins/delendai_expostman/package.json`.
2. Regenerar `bun.lock` con `bun install`.
3. Verificar `bun run --cwd packages/plugins/delendai_expostman test`.
4. Mover `validate:package` a empaquetar el plugin también (cuando deje
   de ser privado).
5. Archivar.

## Por qué esta propuesta queda `done` y no `retired`

- `retired` significa "se canceló sin reemplazo". Aquí sí hay trabajo
  pendiente (S1 trivial) y la activación está clara.
- `done` significa "se cierra con un veredicto". El veredicto es: el
  flujo `file:` es oficial y se reactiva cuando npm lo permita.

## Non-goals (sin cambios)

- Publicar `@delendai/core`. No es de este repositorio.
- Vendorizar `@delendai/core` dentro de este repo.
- Quitar el plugin MCP. Sigue siendo pieza interna del repo.

## Acceptance

- [x] `p00007` cambia de `blocked` a `done` con la nueva fecha.
- [x] `docs/delendai/AGENT-BOOTSTRAP.md` §3.7 declara la práctica
      oficial como aceptable y la separa de "deuda".
- [x] `docs/delendai/proposals/INDEX.md` saca `p00007` de las
      "activas" y la registra como cerrada.
- [x] `bun run lint:proposals` sigue verde.
