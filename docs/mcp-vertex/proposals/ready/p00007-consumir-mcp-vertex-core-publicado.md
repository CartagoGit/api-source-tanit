---
id: p00007
title: "p00007 — consumir `@mcp-vertex/core` publicado en vez del enlace local"
kind: chore
status: blocked
blocked-reason: "@mcp-vertex/core no está en npm todavía (404). El bloqueo es del repositorio mcp-vertex y es operacional (credenciales), no técnico."
type: proposal
track: postman-exporter
date: 2026-07-31
revised: 2026-08-06
related:
    - p00008 # publicar este paquete tiene el mismo tipo de bloqueo operacional
---

> **Revisada 2026-08-06.** La versión original decía "publicar
> `@mcp-vertex/core` a npm **y** cambiar los plugins". La primera mitad
> **no es de este repositorio**. Ver §"reparto real" — esta propuesta se
> queda solo con la parte que sí nos toca.

# p00007 — consumir `@mcp-vertex/core` publicado en vez del enlace local

## Goal

Cambiar la dependencia del plugin:

```diff
- "@mcp-vertex/core": "file:../../../mcp-vertex/packages/core"
+ "@mcp-vertex/core": "^<versión publicada>"
```

para que `plugins/postman-exporter/` no dependa de que el repositorio
`mcp-vertex` esté clonado como hermano de este.

## reparto real

Lo comprobado en `../mcp-vertex` el 2026-08-06:

| Parte | Dónde vive | Estado |
|---|---|---|
| Publicar `@mcp-vertex/core` en npm | repositorio **mcp-vertex** | Máquinaria lista, bloqueado en credenciales del usuario |
| Cambiar el `file:` por la versión publicada | **este** repositorio | Esta propuesta |

En mcp-vertex la publicación está trazada por
[`retired/c00002-pause-npm-publish.md`](../../../../../mcp-vertex/docs/mcp-vertex/proposals/retired/c00002-pause-npm-publish.md),
retirada y superseded por `f00034` (ya cerrada). Está en `retired/`
porque **al repositorio no le queda nada que hacer**: el workflow
`release.yml`, el recordatorio de rotación del token
(`rotate-npm-token.yml`) y la guía `docs/NPM_PUBLISH.md` están en su
sitio. Lo que falta es exclusivamente del usuario:

1. Que exista la organización en npm.
2. Un `NPM_TOKEN` (granular, con bypass de 2FA) como secreto del repo.
3. El merge `develop → main` que dispara la release por tag.

**No se ha creado ninguna propuesta nueva allí**: duplicaría algo ya
cerrado correctamente en un sistema de propuestas que está bien llevado.

## why

Hoy el `file:` funciona porque los dos repositorios viven como hermanos
en la máquina de desarrollo. Deja de funcionar en cuanto alguien clona
solo `postman-exporter`: `bun install` no resuelve la dependencia y el
plugin no arranca.

No es urgente. El plugin MCP es un extra sobre el paquete; el CLI, el
binario y la librería no dependen de `@mcp-vertex/core` para nada, y
`bun run validate` pasa sin él. Por eso esto es `blocked` y no `ready`:
no hay nada que podamos hacer hasta que el paquete exista en npm.

## non-goals

- Publicar `@mcp-vertex/core`. No es de este repositorio y no tenemos
  las credenciales.
- Vendorizar `@mcp-vertex/core` dentro de este repo para saltarse el
  bloqueo. Sería una copia que se desincroniza.
- Quitar el plugin MCP. Funciona y es útil en el entorno de desarrollo.

## slices

### S1 — cambiar la dependencia
- **Files**: `plugins/postman-exporter/package.json`, `bun.lock`.
- **Gate**: `bun install && bun run validate`.

- Sustituir el `file:` por la versión publicada con rango caret.
- **Acceptance**: `bun install` resuelve desde npm y
  `bun test plugins/postman-exporter/tests/` sigue verde.

### S2 — comprobar que el plugin arranca sin el repo hermano
- **Files**: ninguno (verificación).
- **Gate**: clonar este repositorio solo, en un directorio sin
  `../mcp-vertex`, y correr `bun install && bun run validate`.

- **Acceptance**: el gate pasa y
  `plugins/postman-exporter/tests/integration/plugin-boot.spec.ts` sigue
  registrando los 4 tools.

## acceptance

- `grep -rn "file:../../../mcp-vertex" plugins/` no devuelve nada.
- El repositorio se puede clonar y validar en solitario.
- La versión queda fijada con caret, no con `*` ni `latest`.

## cómo desbloquear

`npm view @mcp-vertex/core version` deja de devolver 404. En ese momento
esta propuesta pasa a `ready` y S1 es literalmente una línea.
