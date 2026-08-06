---
id: p00025
title: "p00025 — nombre de producto y bin cortos (acronym-first UX)"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00008 # publish npm — el bin/name del package es la superficie pública
    - p00010 # binario compilado — el nombre del artefacto
    - p00019 # docs de uso e import
    - p00022 # wrappers multi-lenguaje — deben usar el bin corto
---

> **Cerrada 2026-08-06.** Decidido por el dueño del repo:
> **`expostman`** como bin canónico (9 caracteres frente a los 17 de
> `export-to-postman`, que se mantiene como alias al mismo
> entrypoint). El plugin de mcp-vertex toma el mismo nombre, así que
> sus tools pasan de `mcp-vertex_export-to-postman_generate` a
> `mcp-vertex_expostman_generate`.
>
> La tabla de candidatos de la propuesta queda como registro de lo
> que se barajó; `expostman` no estaba en ella y lo aportó el dueño.
>
> `docs/NAMING.md` recoge la decisión, el porqué, y qué NO se
> renombra (la prosa de las propuestas cerradas).


# p00025 — nombre de producto y bin cortos (acronym-first UX)

## Goal

Que invocar la herramienta sea **corto, memorable y honesto con lo que
hace**: escanear rutas de una API y generar artefactos Postman (y en el
futuro vecinos), no “exportar Postman” en abstracto.

Hoy el bin público es `postman-from-routes` (largo) y el package /
repositorio se llaman `postman-exporter` (impreciso: el valor está en
**descubrir rutas + generar colección**, no solo “exportar”).

## why

- Un bin de 19 caracteres fricciona en scripts, Makefiles, CI y
  conversación oral (“¿cómo se llama el comando?”).
- El nombre del producto debe decir **qué hace** (API routes → Postman
  collection) y admitir un **acrónimo de 3–4 letras** usable como bin.
- p00022 va a multiplicar wrappers (`bin/`, Python, PHP, Go…). Si el
  nombre canónico no se fija **antes**, se congela el nombre largo en
  cada ecosistema.
- Usar la librería desde código o MCP no debe obligar a teclear un
  identificador kilométrico; el CLI es la cara humana del mismo motor.

## non-goals

- Renombrar el repositorio de GitHub en el mismo PR que el bin (puede
  quedar como follow-up con redirects).
- Cambiar el schema Postman ni la lógica de scanners.
- Publicar a npm en esta propuesta (sigue siendo p00008 / dueño del
  paquete); aquí solo se **define y cablea** el nombre canónico +
  alias de compatibilidad.
- Resolver el publish de `@mcp-vertex/cli` (p00007); solo alinear docs.

## decision space (elegir en S1, no inventar en cada slice)

Candidatos orientativos (producto → acrónimo → bin). **Uno** se
convierte en canónico; el resto se descartan con justificación breve.

| Producto (human) | Acrónimo | Bin corto | Notas |
| --- | --- | --- | --- |
| **Route → Postman** | `r2p` | `r2p` | Muy corto; genérico; fácil de teclear. |
| **API Route Collection** | `arc` | `arc` | Suena a “arco”; choca con otras CLIs. |
| **Postman Route Kit** | `prk` | `prk` | Corto; sigue anclado a Postman. |
| **Routes to Collection** | `rtc` | `rtc` | Neutro de vendor; claro. |
| **Scan Routes → Postman** | `srp` | `srp` | Enfatiza el scan. |
| **Collection from Routes** | `cfr` | `cfr` | Literal; poco memorable. |
| **Postman From Source** | `pfs` | `pfs` | “from source” > “exporter”. |

Criterios de elección (en orden):

1. **Longitud del bin** ≤ 4 caracteres preferible; ≤ 6 duro.
2. **Dice la acción** (routes/API → collection), no el vendor solo.
3. **Disponible** en npm bin / PATH habitual (comprobar colisiones).
4. **Pronunciable** en ES/EN.
5. **No bloquea** un futuro “no solo Postman” (OpenAPI-only, Insomnia,
   etc.) si el acrónimo es demasiado “postman-*”.

**Compatibilidad:** el bin antiguo `postman-from-routes` permanece como
**alias** al menos una major (deprecation notice en `--help` y README).

## slices

### S1 — Decisión de naming + ADR corto
- **Files**:
  - `docs/mcp-vertex/proposals/ready/p00025-nombre-corto-producto-y-bin.md`
    (esta propuesta: rellenar la tabla “Decidido”).
  - `docs/NAMING.md` (nuevo, ≤ 80 líneas): producto, acrónimo, bin
    canónico, alias, package name npm, env vars prefijo.
- **Gate**: revisión humana del dueño del repo; sin código de runtime.
- **Acceptance**:
  - Queda **un** bin canónico y **un** nombre de producto escritos.
  - Se listan colisiones comprobadas (`npm search`, PATH comunes).
  - Alias de compatibilidad documentado.

### S2 — Superficie CLI (`package.json#bin` + help + binary name)
- **Files**:
  - `package.json` (`bin`, `name` si aplica, `keywords`)
  - `scripts/cli.script.ts` (banner HELP, argv0)
  - `scripts/build-binary.script.ts` (nombre del artefacto compilado)
  - `scripts/validate-package.script.ts` (assert del bin nuevo + alias)
- **Gate**: `bun run validate` + `bun run validate:package`.
- **Acceptance**:
  - `npx <bin-corto> --help` y `npx postman-from-routes --help` (alias)
    responden.
  - El binario compilado se llama `<bin-corto>` (o `<bin-corto>-<os>-<arch>`).
  - El help muestra deprecation de una línea si se invocó el alias.

### S3 — Docs y ejemplos
- **Files**: `README.md`, `docs/INSTALL.md`, `docs/POSTMAN.md`,
  `docs/FRAMEWORKS.md`, `CONTRIBUTING.md`, snippets en `examples/**`
  que citen el comando.
- **Gate**: `rg 'postman-from-routes'` solo aparece en secciones de
  “legacy alias” o changelogs; el path feliz usa el bin corto.
- **Acceptance**: copy-paste del README funciona con el bin nuevo.

### S4 — Alinear p00022 y wrappers
- **Files**: propuesta `p00022` (texto) + futuros `bin/` wrappers
  cuando existan.
- **Gate**: p00022 menciona el bin canónico de p00025, no el largo como
  primario.
- **Acceptance**: ningún wrapper nuevo se documenta solo con el alias.

### S5 — Package / plugin naming (opcional, mismo release train)
- **Files**: root `package.json#name`, plugin
  `plugins/postman-exporter/package.json#name`, referencias MCP
  `NAMESPACE` **solo si** se decide renombrar el package scoped.
- **Gate**: typecheck + tests; si se toca `NAMESPACE`, contrato MCP
  versionado (breaking → `feat!:` o major).
- **Acceptance**:
  - O bien el package npm adopta el nuevo nombre y publica alias
    deprecated del viejo,
  - o se documenta explícitamente “repo/package siguen
    `postman-exporter`; solo el **bin** cambia” (válido si se quiere
    minimizar breaking en imports).

## Decidido (rellenar en S1)

| Campo | Valor |
| --- | --- |
| Producto | _TBD_ |
| Acrónimo | _TBD_ |
| Bin canónico | _TBD_ |
| Alias legacy | `postman-from-routes` |
| Package npm | _TBD_ (¿rename o solo bin?) |
| Prefijo env | _TBD_ (hoy implícito / `POSTMAN_*` si existe) |

## acceptance (propuesta completa)

- Un usuario nuevo copia un comando de ≤ 6 caracteres de nombre de bin
  desde el README y genera una colección.
- `postman-from-routes` sigue funcionando como alias con aviso.
- p00022 y la docs de install no enseñan el nombre largo como primario.
- No hay rutas absolutas de máquina ni dependencia de un checkout
  hermano para documentar el CLI (repo autocontenido).

## risks

- Colisión de nombre corto en npm o en distros.
- Breaking de scripts de usuarios early-adopter del alias actual
  (mitigar con alias largo ≥ 1 major).
- Renombrar `NAMESPACE` MCP rompe hosts ya cableados (por eso S5 es
  opt-in y preferimos primero solo bin + docs).
