---
id: d00001
title: "Documentación y configuración al día con el código que existe"
kind: docs
status: ready
type: proposal
track: export-to-postman
date: 2026-08-08
---

# d00001 — Documentación y configuración al día con el código que existe

## Goal

Que el fichero que gobierna el trabajo de los agentes describa el código que hay, y que haya un gate que lo note cuando vuelva a separarse. Una regla que nadie comprueba se convierte en folclore, y eso es lo que dejó pasar los tres FATAL.

## why

Hallazgos 4 (BAD), 11, 12, 17 y 19 de a00001, más el drift adicional detectado en la auditoría 2026-08-08. `AGENT-BOOTSTRAP.md` es el contrato de trabajo: `CLAUDE.md`, `AGENTS.md` y `.github/copilot-instructions.md` apuntan ahí y a ningún otro sitio. Y describe una arquitectura que ya no existe — §3.8 documenta un `IRouterAdapter` y un `router-dispatcher.service.ts` que no están en el repositorio, §3.1 declara un nombre de tool que no es el que se registra, y cuatro de las rutas que cita no existen. La tabla de §3.5 no menciona `domain/`, `discovery/`, `exporters/` ni `adapters/`, así que los sufijos `.adapter.ts`, `.exporter.ts`, `.orchestrator.ts` y `.pipeline.ts` no están documentados en ninguna parte. Cualquier agente que lo lea trabaja contra un mapa de hace tres reorganizaciones — esta misma auditoría lo pagó. Y el servidor denuncia en `overview.configIssues` que cuatro de las seis raíces de `search` y `conventions` no existen, así que esos dos plugins escanean una fracción del repo sin que nadie se entere. A eso se suma otro drift más pequeño pero más traicionero: `CONTRIBUTING.md` sigue declarando `docs/extension-contract.md` como fuente de verdad aunque ese fichero ya no existe, y el README sigue enlazando la auditoría 2026-08-06 como si fuera la foto vigente.

## non-goals

- Reescribir la prosa de las propuestas cerradas: describen el proyecto como se llamaba entonces y son registro, no documentación
- Tocar `UNIVERSAL-AGENT-BOOTSTRAP.md`: es vendored de upstream y se actualiza copiándolo, no editándolo

## Slices

- global_gate: lint

### S1 — El bootstrap describe la arquitectura que existe
- **Status**: pending
- **Files**: `docs/mcp-vertex/AGENT-BOOTSTRAP.md`, `projects/plugins/mcp-vertex_expostman/src/lib/contracts/namespace.ts`
- **Gate**: lint
- acceptance:
  - "§3.8 describe el trío `IProjectScanner` / `IRouteScanner` / `IValidationSpecProvider`, no `IRouterAdapter`"
  - "§3.1 declara el nombre que el código registra de verdad: `${ctx.namespacePrefix}_${TOOL_ID}`"
  - "Las cuatro rutas muertas (`scripts/lint-tool-no-process.script.ts`, `plugins/export-to-postman/...`, `services/router-dispatcher.service.ts`, `services/router-adapters/`) apuntan a algo que existe"
  - "La constante `NAMESPACE`, que no importa nadie y que §3.1 defendía, desaparece"

### S2 — Los sufijos que el repo usa, documentados
- **Status**: pending
- **Files**: `docs/NAMING.md`
- **Gate**: lint
- acceptance:
  - "`.adapter.ts`, `.exporter.ts`, `.orchestrator.ts` y `.pipeline.ts` están en la tabla, con qué significa cada uno"
  - "La tabla coincide con lo que `lint:naming` acepta de verdad: hoy el lint conoce la lista y la documentación no"

### S3 — La configuración del servidor apunta a carpetas que existen
- **Status**: pending
- **Files**: `mcp-vertex.config.json`, `tests/cli/mcp-config.spec.ts`
- **Gate**: lint
- acceptance:
  - "`plugins.search.options.roots` y `plugins.conventions.options.roots` nombran carpetas reales"
  - "`mcp-vertex_overview` devuelve `configIssues` vacío"
  - "Un test lo comprueba contra el disco, para que mover una carpeta lo rompa aquí y no en silencio"

### S4 — Gate que note cuando el bootstrap vuelva a separarse
- **Status**: pending
- **DependsOn**: [S1, S2]
- **Files**: `scripts/gates/lint-bootstrap-drift.script.ts`, `tests/cli/bootstrap-drift.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "Toda ruta que el bootstrap cite entre backticks tiene que existir en disco"
  - "Todo símbolo que declare como contrato (`IRouterAdapter`, `NAMESPACE`…) tiene que existir en el código"
  - "Se comprueba metiendo una ruta muerta y viendo romper el gate"

### S5 — Las dos carpetas vacías y el README de propuestas
- **Status**: pending
- **Files**: `docs/mcp-vertex/proposals/README.md`, `.gitignore`
- **Gate**: none
- acceptance:
  - "`projects/core/export-to-postman/` y `tests/fixtures/fiber-comprehensive/internal/` desaparecen"
  - "El README de propuestas dice que los ids nuevos llevan prefijo de kind (`a`, `x`, `r`, `f`…) y que `p` es el alias retirado de solo lectura, que es lo que el servidor exige hoy"

### S6 — CONTRIBUTING y README apuntan al contrato y a la auditoría vigentes
- **Status**: pending
- **Files**: `CONTRIBUTING.md`, `README.md`, `docs/mcp-vertex/AUDIT-2026-08-08.md`
- **Gate**: lint
- acceptance:
  - "`CONTRIBUTING.md` deja de citar `docs/extension-contract.md` o cualquier otra fuente muerta"
  - "README enlaza la auditoría vigente y no una foto histórica como si fuera el estado actual"
  - "Las fuentes de verdad del repo quedan escritas donde existen de verdad"

## acceptance

- §3.8 describe el trío `IProjectScanner` / `IRouteScanner` / `IValidationSpecProvider`, no `IRouterAdapter`
- §3.1 declara el nombre que el código registra de verdad: `${ctx.namespacePrefix}_${TOOL_ID}`
- Las cuatro rutas muertas (`scripts/lint-tool-no-process.script.ts`, `plugins/export-to-postman/...`, `services/router-dispatcher.service.ts`, `services/router-adapters/`) apuntan a algo que existe
- La constante `NAMESPACE`, que no importa nadie y que §3.1 defendía, desaparece
- `.adapter.ts`, `.exporter.ts`, `.orchestrator.ts` y `.pipeline.ts` están en la tabla, con qué significa cada uno
- La tabla coincide con lo que `lint:naming` acepta de verdad: hoy el lint conoce la lista y la documentación no
- `plugins.search.options.roots` y `plugins.conventions.options.roots` nombran carpetas reales
- `mcp-vertex_overview` devuelve `configIssues` vacío
- Un test lo comprueba contra el disco, para que mover una carpeta lo rompa aquí y no en silencio
- Toda ruta que el bootstrap cite entre backticks tiene que existir en disco
- Todo símbolo que declare como contrato (`IRouterAdapter`, `NAMESPACE`…) tiene que existir en el código
- Se comprueba metiendo una ruta muerta y viendo romper el gate
- `projects/core/export-to-postman/` y `tests/fixtures/fiber-comprehensive/internal/` desaparecen
- El README de propuestas dice que los ids nuevos llevan prefijo de kind (`a`, `x`, `r`, `f`…) y que `p` es el alias retirado de solo lectura, que es lo que el servidor exige hoy
- `CONTRIBUTING.md` deja de citar `docs/extension-contract.md` o cualquier otra fuente muerta
- README enlaza la auditoría vigente y no una foto histórica como si fuera el estado actual
