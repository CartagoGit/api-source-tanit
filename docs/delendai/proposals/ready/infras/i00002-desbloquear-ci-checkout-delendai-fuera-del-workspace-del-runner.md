---
id: i00002
title: "Desbloquear CI: el checkout delendai cae fuera del workspace del runner"
kind: infra
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-05
dependsOn:
  - a00012
related:
  - p00007
  - c00002
---

# i00002 — CI desbloqueado: `../delendai` ya no puede ser un `actions/checkout`

## Goal

Que `bun run validate` vuelva a ejecutarse de verdad en GitHub Actions.
Hoy el workflow `validate.yml` nunca llega a instalar el proyecto: falla
en el segundo paso, antes de `setup-bun`, y todo lo posterior
(install/validate/audit/package) se salta. Llevamos ≥ 19 commits de rama
sin que Actions haya probado el código.

## Why

El workflow materializa el hermano que el plugin `private` necesita con:

```yaml
- uses: actions/checkout@v7
  with:
    repository: CartagoGit/delendai
    path: ../delendai
```

`actions/checkout` **valida que `path` esté dentro del workspace del
runner** y lo rechaza:

```
Repository path '/home/runner/work/api-source-tanit/delendai' is not
under '/home/runner/work/api-source-tanit/api-source-tanit'
```

(último run fallido: `validate #318`, `#33919891054`).

El hermano `../delendai` es solo la **utilidad host MCP** (§3.7 de
AGENT-BOOTSTRAP): el `file:` del plugin `private: delendai_tanit` lo
resuelve fuera del repo. Esa es la forma soportada mientras
`@delendai/core` no esté publicado en npm (`p00007`), y el hermano es
público con el SHA `f86e0ee…` del pin accesible. No hay que tocar el
otro repo para arreglarlo: basta con materializarlo **sin** pasar por las
restricciones de `actions/checkout`.

## Slices

### S1 — `git clone` en un paso `run` en lugar de `actions/checkout` externo

- **Status**: done (aplicado en esta rama, pendiente de confirmar run verde)
- **Files**:
  - `.github/workflows/validate.yml`
- **Gate**: `gh run watch` sobre un push a `develop` alcanza `✓ Validate`
- **Detalle**:
  - Reemplazar el bloque `actions/checkout` con `path: ../delendai` por un
    paso `run` que hace `git clone --filter=blob:none --no-checkout` +
    `git checkout "${DELENDAI_SHA}"` en `${GITHUB_WORKSPACE}/../delendai`.
    Un script sí puede escribir fuera del workspace del runner; el URL es
    público (solo lectura, sin token).
  - El `file:../../../../delendai/packages/core` del plugin resuelve en la
    misma ruta; no cambia `bun.lock` ni `package.json`.

### S2 — confirmación del árbol verde

- **Status**: pending
- **Files**: ninguno (solo observación)
- **Gate**: `bun run validate` verde **end-to-end** en Actions
- **Detalle**:
  - Esperar al primer run sobre el commit de S1. Si `bun install` o
    `validate` revelan un segundo fallo (p. ej. el plugin local
    `delendai_tanit/src/index.ts` no carga por el `@delendai/core/public`
    que reportó `delendai_overview`), abrir un slice posterior. Este slice
    solo demuestra que el gate corre.

## acceptance

1. Un run push a `develop` llega al paso `Validate` (no se salta nada).
2. Ese run termina verde completo `bun run validate`.
3. El `env.DELENDAI_SHA` sigue siendo el pin único; el workflow y `delendai-sha.constant.ts`
   coinciden en el mismo commit.
4. Ningún archivo de `@delendai/core` (el hermano) es editado desde esta
   rama — el fix es 100 % local a ESTE repo.

## Nota de cierre

El `../delendai` es solo una utilidad; el fix de CI no mueve trabajo de
Tanit a ese repo. Todo lo de i00002 (workflow + esta propuesta) vive en
`api-source-tanit`.
