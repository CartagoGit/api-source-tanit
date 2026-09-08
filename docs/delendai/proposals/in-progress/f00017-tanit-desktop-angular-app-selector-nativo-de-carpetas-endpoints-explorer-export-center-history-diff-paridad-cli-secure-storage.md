---
id: f00017
title: "Tanit Desktop Angular app — selector nativo de carpetas, Endpoints Explorer, Export Center, History diff, paridad CLI, secure storage"
kind: feat
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-09-08
dependencies:
  - a00019#phase-3-project-session-index
---

# f00017 — Tanit Desktop Angular app — selector nativo de carpetas, Endpoints Explorer, Export Center, History diff, paridad CLI, secure storage

## Goal

Reemplazar el monolítico `index.html.constant.ts` (36 KB) por una aplicación Angular real en `packages/app/` con: (1) design system sobrio (tokens cobre, system-ui, spacing base 4, radios 6-12, motion 90-200ms cubic-bezier(.2,.8,.2,1), sin glassmorphism/gradientes/emojis); (2) selector nativo de carpetas + drag&drop + recents (NSOpenPanel/CFileDialog/portal-chooser); (3) Endpoints Explorer con virtual scroll + filtros + detail panel transport-aware; (4) Export Center con capabilities declaradas por exporter + dry-run preview; (5) Services como sección real + History con diff visual contra snapshot anterior; (6) paridad CLI completa (check, sync, validate, push-to-postman, watch/live); (7) secure storage para API key de Postman (Keychain/Credential Manager/Secret Service); (8) command palette ⌘K/Ctrl+K. La misma aplicación Angular se compila y se sirve desde Tauri (Desktop) y desde `apisrc ui` (browser). Cierra el bloque (d) de [a00019 phase-4](../in-progress/a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo señala: (a) la UI actual es funcional pero visualmente "formulario estrecho de 46rem, fieldsets, inputs y una tarjeta de resultado" — no es developer tool para dejar abierto horas; (b) Tanit Desktop pide una ruta de texto cuando los 3 OS tienen selectores nativos; (c) mezcla inglés/español en strings sin pasar por i18n; (d) emojis de health/evidence y carácter de engranaje; (e) theme.constant.ts define tokens azules pero el HTML declara los suyos naranjas — duplicación; (f) `/api/browse` y `/api/dry-run` ya están implementados en el servidor pero la UI no los usa; (g) `theme.constant.ts` y `index.html.constant.ts` están acoplados al monolito; (h) no hay command palette ni atajos configurables; (i) el API key de Postman se guarda en JSON plano, no en Keychain/Credential Manager. Mientras la GUI no sea un developer tool de primera, los 9 comandos CLI que ya tiene Tanit (generate, inspect, list, check, validate, push, watch, history, ui) están ocultos a los usuarios que no abren una terminal.

## Why this design

- **Un build, dos hosts** — `packages/app/dist/` es el artefacto que sirven `apisrc ui` y que empaqueta Tauri. Desktop añade adapters nativos; browser usa el mismo host bridge por HTTP. No se mantiene una UI desktop y otra web.
- **Session-first** — las vistas consumen el `IProjectSnapshot` de `a00019#phase-3-project-session-index`; abrir Endpoints, cambiar de filtro o generar un export no repite scans arbitrariamente.
- **Capabilities antes que claims** — el Export Center deriva cobertura, limitaciones y diagnostics de `ExportCapabilities` y de los exporters, en vez de declarar soporte visual no respaldado por el pipeline.
- **Platform seams explícitas** — dialogs, drag&drop, shell/open y secure storage viven detrás de ports injectables con implementaciones Tauri y browser. Los componentes Angular no importan crates ni ejecutan procesos nativos.
- **CLI como fuente de verdad** — la GUI invoca las mismas operaciones públicas del Application API y expone un comando equivalente por feature. La UI no crea un segundo dialecto de export, check, validate, push o watch.
- **Seguridad por construcción** — el Desktop guarda secretos con la API nativa del sistema operativo. Browser, diagnostics, history, URLs y logs nunca reciben el valor completo de la API key.

## non-goals

- Reescribir Tanit como SaaS multi-tenant — sigue siendo local-first.
- Migrar de Tauri a Electron o incluir el updater firmado; esas responsabilidades pertenecen a la fase de release industrial.
- Añadir Angular Material — el design system es propio con `@angular/cdk` para primitives.
- Cambiar la CLI — la CLI sigue siendo la fuente de verdad; cada feature de GUI tiene un comando CLI equivalente documentado.
- Soporte de Windows ARM64 / Linux ARM64 release — solo x64 + macOS arm64 inicialmente; ARM Linux entra con `i00002`.
- Implementar esta propuesta en este slice; aquí se fija contrato, ownership de archivos, gates y criterios de aceptación.

## Architecture

1. **Angular shell** — `packages/app/src/app/shell/` contiene navegación, command palette y composition de stores. Los primitives reutilizables viven en `shared/` y consumen signals; `@angular/cdk` aporta overlay, a11y, focus trap y virtual scroll.
2. **Host boundary** — `core/api/host-bridge.client.ts` implementa un contrato compartido para `openProject`, `listEndpoints`, `dryRun`, `export`, `historyDiff`, `watch`, `validate`, `check`, `sync` y `push`. Desktop selecciona el bridge stdio sidecar de `f00016`; browser selecciona el bridge HTTP preservado.
3. **Session data plane** — `ProjectStore` consume el snapshot inmutable de `ProjectSession`. Endpoints, Services, History y Export Center derivan operaciones puras sobre ese snapshot; las mutaciones de UI nunca fabrican `IOperation`.
4. **Feature panels** — Endpoints Explorer virtualiza la lista; Services opera sobre `IServiceDescriptor` y referencias por operación; Export Center consume `ExportCapabilities`; History consume hashes canónicos y diffs calculados en core.
5. **Native adapters** — Tauri aporta dialog, drag&drop, open-in-editor/open-folder y `keyring`. Browser usa `/api/browse`, APIs HTTP y el picker soportado por el browser. La entrada manual de ruta queda como fallback avanzado.
6. **Secret boundary** — Desktop resuelve la API key desde Keychain, Credential Manager o Secret Service; browser ofrece únicamente uso temporal en memoria. Ningún secret cruza el bridge hacia history, diagnostics, URL, `localStorage` o logs.
7. **Build/runtime plane** — `apisrc ui`, los tests Angular y Tauri consumen `packages/app/dist/`; scripts de build y `package.json` exponen `test:app` y `build:app` para gates reproducibles.

### Dependency on `a00019#phase-3-project-session-index`

f00017 aterriza después de [phase-3-project-session-index](../in-progress/a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md): necesita `ProjectSession`, el snapshot inmutable, `ProjectIndex`, el Application API y sus bridges stdio/HTTP. El frontend no puede prometer single-scan, watch incremental ni push seguro mientras el sidecar no exponga esos contratos. Esta dependencia global se declara en frontmatter; además, cada slice conserva dependencia lineal para impedir trabajo fuera de orden.

### Dependency graph

- `a00019#phase-3-project-session-index` → S1 Angular foundation.
- S1 → S2 folder picker/drag&drop.
- S2 → S3 Endpoints Explorer.
- S3 → S4 Export Center.
- S4 → S5 Services + History diff.
- S5 → S6 CLI parity + secure storage + Live mode.
- S1–S6 → global e2e gate: `bun run typecheck`, `bun run test:app`, `bun run build:app`, `bun run lint:proposals:gen-index` y, cuando Rust está disponible, `cargo check`.

### Files layout (resultado esperado)

```text
packages/app/
  src/app/
    core/api/              # host bridge y clientes por capability
    core/host/              # ports Tauri/browser + secure storage
    core/state/             # stores signals y estado derivado
    core/i18n/              # catálogos y locale selection
    features/home/          # S2
    features/endpoints/     # S3
    features/exports/       # S4
    features/services/      # S5
    features/history/       # S5
    features/{check,sync,validate,push,live}/ # S6
    shell/                  # S1
    shared/                 # primitives, schema y virtual scroll
  src/styles/
    tokens.scss              # design system contract
    typography.scss
    motion.scss

packages/core/session/
  history-recorder.service.ts
  snapshot-hash.service.ts

packages/desktop/src/
  dialogs.rs
  drag_drop.rs
  secure_storage.rs
  capabilities/main.json

packages/contracts/interfaces/ui/
  host-bridge.interface.ts

docs/CLI.md                    # comandos y ejemplos equivalentes a la GUI
```

## Slices

- global_gate: e2e

### S1-app-angular-foundation — S1 — Angular standalone foundation, design system, shared shell e i18n
  - "`packages/app/` compila con Angular standalone components, signals y control flow; no usa Angular Material y `@angular/cdk` queda limitado a overlay, focus trap, a11y y virtual scroll"
 **Files**: `angular.json`, `package.json`, `bun.lock`, `vitest.config.ts`, `tsconfig.app.json`, `scripts/gates/sections.constant.ts`, `packages/app/package.json`, `packages/app/tsconfig.json`, `packages/app/src/index.html`, `packages/app/src/main.ts`, `packages/app/src/app/app.config.ts`, `packages/app/src/styles.scss`, `packages/app/src/styles/tokens.scss`, `packages/app/src/styles/typography.scss`, `packages/app/src/styles/motion.scss`, `packages/app/src/app/shell/app-shell.component.ts`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/shell/command-palette.component.ts`, `packages/app/src/app/shared/button/button.component.ts`, `packages/app/src/app/shared/badge/badge.component.ts`, `packages/app/src/app/shared/empty-state/empty-state.component.ts`, `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/state/project.store.ts`, `packages/app/src/app/core/state/command.store.ts`, `packages/app/src/app/core/i18n/i18n.service.ts`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/contracts/interfaces/ui/host-bridge.interface.ts`, `packages/contracts/interfaces/ui/palette-command.interface.ts`, `packages/cli/commands/ui.script.ts`, `packages/contracts/interfaces/cli/ui.interface.ts`, `packages/ui/server/ui-server.service.ts`, `packages/desktop/tauri.conf.json`, `tests/app/shell.spec.ts`, `tests/cli/ui-static-assets.spec.ts`
  - "`tokens.scss` es la única fuente de tokens: cobre sobrio, light `#F7F7F5`/`#17191C`, dark `#101214`/`#F2F3F3`, system-ui, code con ui-monospace/SFMono/Cascadia/Consolas, spacing base 4, radios 6/8/10/12 y motion `cubic-bezier(.2,.8,.2,1)` de 90–200 ms; no glassmorphism, gradientes decorativos ni emojis"
    - "La configuración de build raíz declara el artefacto `packages/app/dist` que consume Desktop; las dependencias nativas de dialog y secure storage quedan en S2/S6, donde se implementan sus adapters"
  - "Shell incluye Sidebar Overview/Endpoints/Schemas/Services/Exports/History/Diagnostics/Settings, navegación 100% por teclado, theme switch sin flash y command palette ⌘K/Ctrl+K con open/rescan/search/export/settings/help/theme/recent"
  - "Command palette aplica fuzzy search, foco trapped y selección por flechas/Enter/Escape; todas sus acciones se traducen mediante el servicio i18n"
  - "`en.json` es reference; `es.json` es complete con contenido distinto en al menos la mitad de las keys comunes; no se renderizan claves crudas"
  - "El contrato `IHostBridge` define operaciones host-agnostic con input/output tipados; la UI conoce el contrato, no Tauri ni crates"
  - "`apisrc ui` sirve `packages/app/dist/`; el script desktop empaqueta exactamente ese mismo artefacto"
  - "Tests de `tests/app/shell.spec.ts` cubren render, ocho acciones del palette, i18n, theme y foco"
  - "DoD slice: `bun run typecheck && bun run test:app && bun run build:app` verdes"
- review-state: done
- review-implementer: orchestrator
- review-reviewer: technical_investigator
- review-log: requested_changes by delivery_verifier — La revisión inicial queda parcialmente atendida: builder Angular moderno produce bundle real en packages/app/dist; Tauri y apisrc ui ya se alinean. Siguen pendientes cobertura DOM/render/tema/foco en tests/app/shell.spec.ts y una verificación del serving estático del index Angular. Solicito cambios antes de aprobar.
- review-log: approved by technical_investigator — Revisión fresca aprobada. f89d897 mueve IPaletteCommand a packages/contracts/interfaces/ui/palette-command.interface.ts y actualiza ambos consumidores; imports resuelven. Branch develop limpio y alineado con origin/develop. Gates confirmados: typecheck app/contracts/cli, test:app 6/6 y build:app con bundle real en packages/app/dist. No quedan blockers dentro del alcance de S1.
- **Status**: done
### S2-folder-picker-dragdrop — S2 — Folder picker nativo, drag&drop, recents y browse browser
- **Status**: pending
- **DependsOn**: [S1-app-angular-foundation]
- **Files**: `packages/desktop/src/dialogs.rs`, `packages/desktop/src/drag_drop.rs`, `packages/desktop/capabilities/main.json`, `packages/app/src/app/features/home/folder-picker.component.ts`, `packages/app/src/app/features/home/recent-projects.component.ts`, `packages/app/src/app/features/home/home.component.ts`, `packages/app/src/app/core/host/dialog.service.ts`, `packages/app/src/app/core/host/drag-drop.service.ts`, `packages/app/src/app/core/state/recent-projects.store.ts`, `packages/app/src/app/core/api/recent-projects.client.ts`, `tests/app/folder-picker.spec.ts`, `tests/app/recent-projects.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Tauri instala `tauri-plugin-dialog` y declara la capability mínima; Desktop selecciona carpeta con NSOpenPanel en macOS, IFileOpenDialog en Windows y XDG Portal chooser en Linux"
  - "Drag&drop de Tauri propaga `WindowEvent::DragDrop` al webview, muestra hover/drop states accesibles y entrega solo una ruta contenida al host bridge"
  - "Recents mantiene como máximo diez proyectos, workspace-scoped, ordenados por last-opened y sin secretos; permite forget-one, forget-all y reintento desde la ruta recordada"
  - "Browser usa `/api/browse` como fallback con breadcrumbs, parent navigation, keyboard support, list truncation y exclusión de symlinks; si el browser ofrece directory access, el adapter lo usa sin lógica duplicada"
  - "La entrada manual de ruta queda colapsada en Advanced y nunca es la acción primaria"
  - "El empty state inicial muestra 'Tus APIs', CTA 'Abrir un proyecto…', drop zone y recents, sin pedir una ruta como primer paso"
  - "Tests cubren invocación del dialog mockeado, evento drag&drop, add/remove/clear, persistencia, ordering y forget-one/all"
  - "DoD slice: `bun run typecheck && bun run test:app && cargo check` verdes"

### S3-endpoints-explorer — S3 — Endpoints Explorer virtualizado, filtros combinables y detail transport-aware
- **Status**: pending
- **DependsOn**: [S2-folder-picker-dragdrop]
- **Files**: `packages/app/src/app/features/endpoints/endpoints-list.component.ts`, `packages/app/src/app/features/endpoints/endpoint-detail.component.ts`, `packages/app/src/app/features/endpoints/transport-inspector.directive.ts`, `packages/app/src/app/features/endpoints/filters.component.ts`, `packages/app/src/app/features/endpoints/schema-viewer.component.ts`, `packages/app/src/app/features/endpoints/code-snippet.component.ts`, `packages/app/src/app/core/state/endpoints.store.ts`, `packages/app/src/app/core/api/endpoints.client.ts`, `packages/app/src/app/shared/virtual-scroll/virtual-scroller.component.ts`, `tests/app/endpoints.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`@angular/cdk` `cdk-virtual-scroll-viewport` mantiene 5.000+ operaciones sin scan adicional y ofrece 60fps objetivo en scroll"
  - "Filtros combinables por service, framework, transport, method, auth, validation, responses, confidence, source file y fuzzy search sobre path/method/description"
  - "Detail panel tiene Overview/Request/Responses/Validation/Auth/Evidence/Source y un adapter exhaustivo para HTTP, gRPC, GraphQL, WebSocket, SSE y message broker"
  - "Cada rama transport muestra solo sus campos requeridos; un diagnostic se puede pulsar para aplicar el filtro y la URL conserva deep-link query params"
  - "Schema viewer árbol y code snippet read-only permiten copy de JSON path y location `file:line:col`; open-in-editor usa el port nativo"
  - "Tests cubren 5k items, filtros combinados, seis transports, Evidence, deep-link y drag-to-resize del split"
  - "DoD slice: `bun run typecheck && bun run test:app` verdes; smoke e2e NestJS abre Endpoints sin re-scan usando ProjectSession"

### S4-export-center-capabilities — S4 — Export Center, capabilities, dry-run, overwrite guard y diagnostics
- **Status**: pending
- **DependsOn**: [S3-endpoints-explorer]
- **Files**: `packages/app/src/app/features/exports/export-center.component.ts`, `packages/app/src/app/features/exports/export-preview.component.ts`, `packages/app/src/app/features/exports/format-capabilities.component.ts`, `packages/app/src/app/features/exports/export-summary.component.ts`, `packages/app/src/app/core/api/exports.client.ts`, `packages/app/src/app/core/state/exports.store.ts`, `tests/app/export-center.spec.ts`
- **Gate**: e2e
- acceptance:
  - "El centro lista Postman, OpenAPI 3.1, Insomnia v4, Bruno, HAR y cURL con `ExportCapabilities` y counts reales; una pérdida se muestra como partial/lossy, nunca como full"
  - "Dry-run muestra NEW/UPDATE/UNCHANGED, archivos fuera de workspace y riesgo de overwrite antes de habilitar Generate"
  - "`ExportDiagnostic` conserva code, severity, operationIds, message y suggestion; un código se puede pulsar para filtrar Endpoints"
  - "Success ofrece open-folder/open Postman mediante ports nativos, fallback si Postman no está instalado y copy paths"
  - "Output directory se selecciona con dialog, muestra ruta relativa/absoluta y exige confirmación si queda fuera del workspace"
  - "Tests cubren selección de formatos, preview, overwrite confirmado/denegado y cero/uno/varios diagnostics"
  - "DoD slice: `bun run typecheck && bun run test:app && bun run validate:examples` verdes"

### S5-services-and-history-diff — S5 — Services, historial canónico y diff visual por operación/servicio
- **Status**: pending
- **DependsOn**: [S4-export-center-capabilities]
- **Files**: `packages/app/src/app/features/services/services-list.component.ts`, `packages/app/src/app/features/services/service-detail.component.ts`, `packages/app/src/app/features/history/history-list.component.ts`, `packages/app/src/app/features/history/history-diff.component.ts`, `packages/app/src/app/core/api/services.client.ts`, `packages/app/src/app/core/api/history.client.ts`, `packages/app/src/app/core/state/history.store.ts`, `packages/core/session/history-recorder.service.ts`, `packages/core/session/snapshot-hash.service.ts`, `tests/app/services.spec.ts`, `tests/app/history.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Services lista framework, transports, auth, base URL, operation count y desglose por transporte; detail expone `serverRef`/`authRef` por operación"
  - "Combined export se marca partial y explica exportar por servicio mientras no todos los exporters garanticen referencias por operación"
  - "Cada run guarda timestamp, formats, operation count, output directory y SHA-256 del canonical JSON del snapshot inmutable"
  - "Diff entre dos runs informa operaciones añadidas/eliminadas, schemas y auth cambiados por servicio/operación; nunca afirma un cambio global sin evidencia"
  - "Diff habilita re-export con config, compare config y restore settings sin perder provenance"
  - "Tests cubren multi-service con auth/base URL divergentes y diffs de dos snapshots con cambios de operaciones, schemas y auth"
  - "DoD slice: `bun run typecheck && bun run test:app` verdes"

### S6-cli-parity-secure-storage-live — S6 — Paridad CLI, Live mode, secure storage y push-to-Postman
- **Status**: pending
- **DependsOn**: [S5-services-and-history-diff]
- **Files**: `packages/cli/cli.script.ts`, `packages/cli/commands/sync.script.ts`, `docs/CLI.md`, `packages/app/src/app/features/check/check.component.ts`, `packages/app/src/app/features/sync/sync.component.ts`, `packages/app/src/app/features/validate/validate.component.ts`, `packages/app/src/app/features/push/push-to-postman.component.ts`, `packages/app/src/app/features/settings/settings.component.ts`, `packages/app/src/app/features/live/live-toggle.component.ts`, `packages/app/src/app/core/host/secure-storage.service.ts`, `packages/app/src/app/core/state/live.store.ts`, `packages/app/src/app/core/api/check.client.ts`, `packages/app/src/app/core/api/push.client.ts`, `packages/desktop/src/secure_storage.rs`, `tests/app/cli-parity.spec.ts`, `tests/app/secure-storage.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Desktop guarda la API key de Postman mediante `keyring` (Keychain/Credential Manager/Secret Service), muestra solo masked value y permite 'Use for this session only' solo en memoria; browser no persiste el secreto"
  - "Push desde GUI usa el mismo handler CLI/API, workspace selector, dry-run, retry exponencial ante rate limit y diagnostics estructurados; secretos no aparecen en errores, history ni logs"
  - "Live mode muestra Watching N source files, notifica operaciones añadidas/modificadas/eliminadas y separa watch de auto-export; auto-export permanece opt-in y off por defecto"
  - "Check, Sync, Validate, Push y Watch son accesibles desde Sidebar con diagnostics severity/code/file:line/suggestion, navegación keyboard y botón de retry/cancel cuando aplica"
  - "La CLI sigue siendo la referencia funcional: cada feature tiene comando equivalente y `docs/CLI.md` documenta inputs, output, diagnostics y ejemplos; `sync` no introduce una segunda pipeline"
  - "Tests cubren cada feature desde GUI, browser session-only, save/retrieve/delete del keyring mock, rate limit, cancellation y ausencia de secretos en artefactos"
  - "DoD slice: `bun run typecheck && bun run test:app && cargo check && bun run validate:examples` verdes"

## acceptance

- `packages/app/` compila standalone + signals, tiene un `tokens.scss` canónico y no depende de Angular Material.
- El mismo `packages/app/dist/` alimenta `apisrc ui` y Tauri; Desktop usa bridge stdio, browser usa HTTP.
- Folder picker nativo + drag&drop, `/api/browse` browser y recents de diez proyectos están cubiertos por tests.
- Endpoints Explorer virtualiza 5k+ operaciones, combina filtros y presenta detalle correcto para los seis transports sin re-scan.
- Export Center consume capabilities, dry-run y diagnostics; comunica pérdidas de representabilidad y protege sobrescrituras.
- Services y History muestran referencias por servicio/operación y diffs de snapshots con hash SHA-256.
- Check, sync, validate, push, watch y live mode conservan paridad CLI; el secret de Postman usa secure storage nativo o memoria temporal.
- Gates: `bun run lint:proposals:gen-index`, `bun run typecheck`, `bun run test:app`, `bun run build:app`; los gates Rust se ejecutan donde Rust está disponible.

## Risks

- **Dependencia dura de phase-3** — sin ProjectSession, Application API y bridges, los slices no tienen backend estable. Mitigación: dependencia global en frontmatter y ninguna aceptación de UI afirma single-scan antes de cerrarla.
- **Migración de la UI monolítica** — reemplazar `UI_HTML`/`index.html.constant.ts` puede romper rutas o tests. Mitigación: S1 introduce el build como capability opt-in, mantiene el runtime anterior detrás de flag durante el gate y hace la migración por slices; no se elimina la ruta legacy hasta que Desktop/browser smoke sean verdes.
- **Secure storage por plataforma** — keyring puede no estar disponible en Linux headless o builds de CI. Mitigación: adapter con trait, mock determinista en tests, error diagnosticado sin revelar el secreto y fallback session-only en browser.
- **Scope de S2/S3** — dialogs, drag&drop, browse, virtual scroll y filtros comparten estado. Mitigación: ownership de directorios disjuntos, ports host separados y DoD por slice.
- **Rendimiento del virtual scroll** — 5k items no garantiza 60fps en un fixture mínimo. Mitigación: benchmark reproducible, altura de fila fija, `trackBy`/keys estables y smoke con proyecto NestJS real.
- **Capabilities y exporter drift** — un exporter puede prometer soporte que el pipeline no materializa. Mitigación: capabilities derivan del registry y el UI muestra counts/diagnostics de la ejecución real.
- **History y secretos** — un diff podría copiar rutas o config sensible, y un retry podría repetir push. Mitigación: canonical snapshot hashing, provenance por operación, confirmación de push, límites de reintento y `redactSecrets` antes de persistir/loguear.
- **Paridad CLI/GUI** — nombres de acciones pueden divergir. Mitigación: `IHostBridge` compartido, `docs/CLI.md` como índice y test de contrato por operación.
- **Alcance de updater** — agregar updater aquí ampliaría fase-4 hacia release industrial. Se excluye deliberadamente; secure storage permanece local y sin firma.
