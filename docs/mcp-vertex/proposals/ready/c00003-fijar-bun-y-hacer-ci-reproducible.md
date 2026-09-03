---
id: c00003
title: "Fijar Bun y hacer reproducible la CI"
kind: chore
status: ready
type: proposal
track: export-to-postman
date: 2026-09-03
dependsOn: []
related:
  - p00007
  - a00009
  - a00010
  - a00011
---

# c00003 — fijar Bun y hacer reproducible la CI

## Goal

Evitar que los workflows dependan de la versión cambiante de `latest` y
asegurar que todos los jobs instalan exactamente el lockfile comprometido.

## Contexto

La auditoría externa del 3 de septiembre de 2026 detectó que los workflows
usan `bun-version: latest`. Además, `release-desktop.yml` usa `bun install`
sin `--frozen-lockfile`, a diferencia de los demás flujos. Eso permite que
una actualización del runtime o del lockfile altere el resultado de CI sin
un cambio explícito en el repositorio.

La dependencia local de `@mcp-vertex/core` queda fuera de esta propuesta y
continúa bloqueada en `p00007`: el paquete todavía no está publicado.

## Alcance

- Elegir una versión concreta de Bun compatible con el repositorio y el
  plugin MCP.
- Usar esa versión en todos los usos de `oven-sh/setup-bun`.
- Cambiar la instalación del workflow de escritorio a
  `bun install --frozen-lockfile`.
- Añadir un gate que rechace `bun-version: latest` y las instalaciones no
  congeladas en workflows de validación o release.
- Mantener los rangos `engines.bun` como requisito de compatibilidad del
  paquete, salvo que la implementación justifique alinearlos con CI.

## No incluido

- Publicar `@mcp-vertex/core` o sustituir el enlace `file:`; eso depende de
  npm y pertenece a `p00007`.
- Actualizar dependencias no relacionadas con la reproducibilidad de Bun.
- Reescribir los workflows de packaging más allá de su instalación y
  configuración del runtime.

## Slices

### S1 — workflow y runtime fijados

- Actualizar los cuatro workflows que configuran Bun.
- Usar `bun install --frozen-lockfile` en `release-desktop.yml`.
- Documentar la versión elegida y su criterio en el repositorio si no es
  evidente por la configuración existente.

### S2 — gate de deriva

- Añadir un script de lint pequeño y determinista que inspeccione los
  workflows.
- Integrarlo en `bun run lint`.
- Cubrir los casos `latest` y `bun install` sin `--frozen-lockfile`.

### S3 — validación

- Ejecutar el lint focalizado, `bun run lint:proposals`, los typechecks y la
  validación completa disponible en el entorno.
- Verificar que los cambios no intentan resolver `p00007` mientras el paquete
  siga sin publicación.

## Acceptance

- Ningún workflow usa `bun-version: latest`.
- Ningún workflow de validación o release usa `bun install` sin
  `--frozen-lockfile`.
- El nuevo gate falla ante ambas formas de deriva y pasa con los workflows
  corregidos.
- `bun run validate` permanece verde, salvo un bloqueo externo documentado
  por la dependencia de `@mcp-vertex/core`.