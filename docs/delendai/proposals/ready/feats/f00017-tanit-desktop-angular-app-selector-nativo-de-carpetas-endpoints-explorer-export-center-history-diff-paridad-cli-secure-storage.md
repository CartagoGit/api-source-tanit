---
id: f00017
title: "Tanit Desktop Angular app — selector nativo de carpetas, Endpoints Explorer, Export Center, History diff, paridad CLI, secure storage"
kind: feat
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
---

# f00017 — Tanit Desktop Angular app — selector nativo de carpetas, Endpoints Explorer, Export Center, History diff, paridad CLI, secure storage

## Goal

Reemplazar el monolítico `index.html.constant.ts` (36 KB) por una aplicación Angular real en `packages/app/` con: (1) design system sobrio (tokens cobre, system-ui, spacing base 4, radios 6-12, motion 90-200ms cubic-bezier(.2,.8,.2,1), sin glassmorphism/gradientes/emojis); (2) selector nativo de carpetas + drag&drop + recents (NSOpenPanel/CFileDialog/portal-chooser); (3) Endpoints Explorer con virtual scroll + filtros + detail panel transport-aware; (4) Export Center con capabilities declaradas por exporter + dry-run preview; (5) Services como sección real + History con diff visual contra snapshot anterior; (6) paridad CLI completa (check, sync, validate, push-to-postman, watch/live); (7) secure storage para API key de Postman (Keychain/Credential Manager/Secret Service); (8) command palette ⌘K/Ctrl+K. La misma aplicación Angular se compila y se sirve desde Tauri (Desktop) y desde `apisrc ui` (browser). Cierra el bloque (d) de [a00019](./a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo señala: (a) la UI actual es funcional pero visualmente "formulario estrecho de 46rem, fieldsets, inputs y una tarjeta de resultado" — no es developer tool para dejar abierto horas; (b) Tanit Desktop pide una ruta de texto cuando los 3 OS tienen selectores nativos; (c) mezcla inglés/español en strings sin pasar por i18n; (d) emojis de health/evidence y carácter de engranaje; (e) theme.constant.ts define tokens azules pero el HTML declara los suyos naranjas — duplicación; (f) `/api/browse` y `/api/dry-run` ya están implementados en el servidor pero la UI no los usa; (g) `theme.constant.ts` y `index.html.constant.ts` están acoplados al monolito; (h) no hay command palette ni atajos configurables; (i) el API key de Postman se guarda en JSON plano, no en Keychain/Credential Manager. Mientras la GUI no sea un developer tool de primera, los 9 comandos CLI que ya tiene Tanit (generate, inspect, list, check, validate, push, watch, history, ui) están ocultos a los usuarios que no abren una terminal.

## non-goals

- Reescribir Tanit como SaaS multi-tenant — sigue siendo local-first.
- Migrar a Tauri 2.0 desde Tauri 1.x si es complejo — se mantiene Tauri actual; los plugins oficiales (dialog, secure storage, updater) se añaden via Cargo o npm.
- Añadir Angular Material — el design system es propio con `@angular/cdk` para primitives.
- Cambiar la CLI — la CLI sigue siendo la fuente de verdad; cada feature de GUI tiene un comando CLI equivalente documentado.
- Soporte de Windows ARM64 / Linux ARM64 release — solo x64 + macOS arm64 inicialmente; ARM Linux entra con `i00002`.

## Slices

- global_gate: e2e

### S1-app-angular-foundation — S1 — packages/app Angular foundation: shell, design tokens, command palette, i18n
- **Status**: pending
- **Files**: `packages/app/angular.json`, `packages/app/tsconfig.json`, `packages/app/package.json`, `packages/app/src/main.ts`, `packages/app/src/styles/tokens.scss`, `packages/app/src/styles/typography.scss`, `packages/app/src/styles/motion.scss`, `packages/app/src/app/shell/app-shell.component.ts`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/shell/command-palette.component.ts`, `packages/app/src/app/shared/button/button.component.ts`, `packages/app/src/app/shared/badge/badge.component.ts`, `packages/app/src/app/shared/empty-state/empty-state.component.ts`, `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/state/project.store.ts`, `packages/app/src/app/core/state/command.store.ts`, `packages/app/src/app/core/i18n/i18n.service.ts`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `tests/app/shell.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`packages/app/` compila standalone components + signals (Angular 17+); sin Angular Material; `@angular/cdk` para overlay, focus trap, virtual scroll, a11y"
  - "Design tokens: cobre sobrio (light #F7F7F5 bg / #17191C text / cobre oscuro accent; dark #101214 bg / #F2F3F3 text / cobre claro accent); system-ui para UI; ui-monospace/SFMono-Regular/Cascadia Mono/Consolas para code; spacing base 4; radios 6/8/10/12 (input/button/panel/dialog); motion `cubic-bezier(.2,.8,.2,1)` 90-120ms hover / 150-170ms view transition / 180-200ms dialog"
  - "Command palette ⌘K/Ctrl+K con 8 acciones (open, rescan, search, export, settings, help, theme, recent); filtro fuzzy; keyboard-only navigation"
  - "i18n: `en.json` reference (canonical), `es.json` complete (traducción real, distinto del reference en al menos 50% de keys comunes); `experimental` solo para locales en progreso"
  - "Sidebar con Overview/Endpoints/Schemas/Services/Exports/History/Diagnostics/Settings; navegación keyboard 100% (Tab/flechas/Enter)"
  - "`apisrc ui` sirve `packages/app/dist/` como artefacto único; Tauri empaqueta el mismo dist — single source of UI"
  - "Tests: `tests/app/shell.spec.ts` cubre render del shell + command palette (8 acciones) + i18n switch + theme switch (sin flashes)"
  - "DoD slice: `bun run typecheck && bun run test:app && bun run build:app` verdes"

### S2-folder-picker-dragdrop — S2 — Folder picker nativo + drag&drop + recents (Desktop) + /api/browse (browser) + Cargo.toml con todos los plugins
- **Status**: pending
- **DependsOn**: [S1-app-angular-foundation]
- **Files**: `packages/desktop/src-tauri/Cargo.toml`, `packages/desktop/src-tauri/src/dialogs.rs`, `packages/desktop/src-tauri/src/drag_drop.rs`, `packages/desktop/src-tauri/capabilities/main.json`, `packages/app/src/app/features/home/folder-picker.component.ts`, `packages/app/src/app/features/home/recent-projects.component.ts`, `packages/app/src/app/features/home/home.component.ts`, `packages/app/src/app/core/host/dialog.service.ts`, `packages/app/src/app/core/host/drag-drop.service.ts`, `packages/app/src/app/core/state/recent-projects.store.ts`, `packages/app/src/app/core/api/recent-projects.client.ts`, `tests/app/folder-picker.spec.ts`, `tests/app/recent-projects.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Tauri dialog plugin instalado (`tauri-plugin-dialog`); capability grant en `capabilities/main.json`; abrir proyecto abre `NSOpenPanel` (macOS), `IFileOpenDialog` (Windows), `XDG Portal` chooser (Linux)"
  - "Drag&drop: Tauri `WindowEvent::DragDrop` propagado al webview; drop zone visual con highlight; soltar carpeta = trigger `openProject(path)`"
  - "Recents: últimos 10 proyectos persistidos en settings local (workspace-scoped, sin secretos); panel de Settings permite olvidar uno o todos; orden por last-opened"
  - "`apisrc ui` (browser): cuando el host bridge es HTTP (no stdio), usa `/api/browse` como fallback; modal con breadcrumbs + keyboard navigation + parent + truncated long lists + permisos (symlinks excluidos); la UX es equivalente al native picker en lo que el browser permite"
  - "Field de "pegar ruta manualmente" relegado a `Advanced` collapsed section; nunca es la primera acción visible"
  - "Empty state inicial: "Tus APIs" + CTA "Abrir un proyecto…" + drop zone + recents — sin pedir ruta en texto"
  - "`Cargo.toml` añade TODAS las dependencias Tauri que la propuesta necesita (dialog, stronghold/keyring, updater) en este slice — los Rust crates se declaran aunque su uso llegue en S6; evita solapamiento entre slices"
  - "Tests: `folder-picker.spec.ts` cubre native dialog invocation (mock), drag&drop event, recents add/remove/clear; `recent-projects.spec.ts` cubre persistencia + ordering + forget-one + forget-all"
  - "DoD slice: `bun run typecheck && bun run test:app && cargo check` verdes"

### S3-endpoints-explorer — S3 — Endpoints Explorer: virtual scroll, filtros, detail panel transport-aware
- **Status**: pending
- **DependsOn**: [S2-folder-picker-dragdrop]
- **Files**: `packages/app/src/app/features/endpoints/endpoints-list.component.ts`, `packages/app/src/app/features/endpoints/endpoint-detail.component.ts`, `packages/app/src/app/features/endpoints/transport-inspector.directive.ts`, `packages/app/src/app/features/endpoints/filters.component.ts`, `packages/app/src/app/features/endpoints/schema-viewer.component.ts`, `packages/app/src/app/features/endpoints/code-snippet.component.ts`, `packages/app/src/app/core/state/endpoints.store.ts`, `packages/app/src/app/core/api/endpoints.client.ts`, `packages/app/src/app/shared/virtual-scroll/virtual-scroller.component.ts`, `tests/app/endpoints.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Lista virtual scroll (`@angular/cdk` `cdk-virtual-scroll-viewport`) soporta 5k+ operations sin lag perceptible (60fps scroll); filtros combinables por service/framework/transport/method/auth/has-validation/has-responses/confidence/source-file + search fuzzy en path+method+description"
  - "Detail panel con tabs Overview/Request/Responses/Validation/Auth/Evidence/Source; `TransportInspectorDirective` adapta el render: HTTP muestra method+path+headers+query+body; gRPC muestra service+rpc+streaming+request/response types; GraphQL muestra operationType+operationName+variables+schema; WS muestra namespace+event+direction+payload; SSE muestra stream+event+payload; broker muestra broker+channel+direction+message"
  - "Click en diagnostic (e.g. "8 operations have no validation") aplica el filtro correspondiente; URL query param sincronizado con el state para deep-link"
  - "Schema viewer para request/response bodies: JSON Schema → tree view con tipos, descripciones, examples; unfold por niveles; copy al clipboard del path JSON"
  - "Code snippet read-only con syntax highlight (highlight.js o Prism vía npm); botones "Open in editor" (Tauri `tauri-plugin-shell` → `open` con VSCode/Cursor URL) y "Copy location" (`file:line:col`)"
  - "Tests: `endpoints.spec.ts` cubre render de 5k items, filtros combinados, detail panel por transport (uno por cada uno de los 6 transports), Evidence tab, drag-to-resize del split entre list y detail"
  - "DoD slice: `bun run typecheck && bun run test:app` verdes; smoke e2e con proyecto fixture NestJS abre Endpoints Explorer sin re-scan (usa ProjectSession de `f00016`)"

### S4-export-center-capabilities — S4 — Export Center: capabilities declaradas por exporter + dry-run preview + diagnostics estructurados
- **Status**: pending
- **DependsOn**: [S3-endpoints-explorer]
- **Files**: `packages/app/src/app/features/exports/export-center.component.ts`, `packages/app/src/app/features/exports/export-preview.component.ts`, `packages/app/src/app/features/exports/format-capabilities.component.ts`, `packages/app/src/app/features/exports/export-summary.component.ts`, `packages/app/src/app/core/api/exports.client.ts`, `packages/app/src/app/core/state/exports.store.ts`, `tests/app/export-center.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Export Center lista formatos con capabilities declaradas (consume `ExportCapabilities` de `r00019` S4): Postman, OpenAPI 3.1, Insomnia v4, Bruno, HAR, cURL — cada uno con counts honestos (e.g. "OpenAPI: 72/84 operations; 12 GraphQL operations cannot be represented as path+method")"
  - "Dry-run preview muestra archivos `NEW`/`UPDATE`/`UNCHANGED` + warning explícito si va a sobrescribir archivos no generados por Tanit; botón Generate deshabilitado hasta aceptar el preview"
  - "Diagnostics estructurados (`ExportDiagnostic { code, severity, operationIds[], message, suggestion }`) con severity icon (info/warning/error), código clickeable que filtra Endpoints Explorer; ningún exporter emite warning genérico sin código"
  - "Success state: "Open folder" (Tauri `shell.open`) + "Open Postman" (`postman://` protocol url, con fallback si no instalado) + "Copy paths""
  - "Output dir editable vía native dialog; muestra ruta relativa al proyecto (e.g. `./tanit/`) + ruta absoluta; validation: dentro del workspace o pide confirmación si fuera"
  - "Tests: `export-center.spec.ts` cubre selección/deselección de formatos, dry-run con preview, generate con/sin overwrite, success con 0/1/N diagnostics"
  - "DoD slice: `bun run typecheck && bun run test:app && bun run validate:examples` verdes"

### S5-services-and-history-diff — S5 — Services como sección real + History con snapshot-hash + diff visual
- **Status**: pending
- **DependsOn**: [S4-export-center-capabilities]
- **Files**: `packages/app/src/app/features/services/services-list.component.ts`, `packages/app/src/app/features/services/service-detail.component.ts`, `packages/app/src/app/features/history/history-list.component.ts`, `packages/app/src/app/features/history/history-diff.component.ts`, `packages/app/src/app/core/api/services.client.ts`, `packages/app/src/app/core/api/history.client.ts`, `packages/app/src/app/core/state/history.store.ts`, `packages/core/session/history-recorder.service.ts`, `packages/core/session/snapshot-hash.service.ts`, `tests/app/services.spec.ts`, `tests/app/history.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Services screen lista cada service con framework/transport/auth/baseUrl/operationCount; service detail muestra breakdown por transport + per-operation serverRef/authRef (consume `IOperation.serverRef`/`authRef` de `r00019`)"
  - "UI marca "Combined export" como partial + recomienda "Export each service separately" mientras per-operation serverRef no esté garantizado en todos los exporters (badge con tooltip explicativo)"
  - "History graba snapshot-hash por run (`SHA-256` del canonical JSON del snapshot); cada entry: timestamp, formats, operationCount, snapshotHash, outputDir"
  - "History Diff: entre dos runs, muestra `+N operations`/`-M operations`/`~K schemas changed`/`~J auth changed` — no "auth changed globally" sino por servicio y operación"
  - "Acciones desde diff: "Re-export with this config" / "Compare config" / "Restore settings""
  - "Tests: `services.spec.ts` cubre multi-service con auth/baseUrl distintos (consume `tests/fixtures/multi-service/` de `r00019` S3); `history.spec.ts` cubre diff entre dos runs con cambios detectados correctamente"
  - "DoD slice: `bun run typecheck && bun run test:app` verdes"

### S6-cli-parity-secure-storage-live — S6 — Paridad CLI en GUI + secure storage para Postman API key + Live mode + check/sync/validate/push
- **Status**: pending
- **DependsOn**: [S5-services-and-history-diff]
- **Files**: `packages/app/src/app/features/check/check.component.ts`, `packages/app/src/app/features/sync/sync.component.ts`, `packages/app/src/app/features/validate/validate.component.ts`, `packages/app/src/app/features/push/push-to-postman.component.ts`, `packages/app/src/app/features/settings/settings.component.ts`, `packages/app/src/app/features/live/live-toggle.component.ts`, `packages/desktop/src-tauri/src/secure_storage.rs`, `packages/desktop/src-tauri/src/updater.rs`, `packages/desktop/src-tauri/capabilities/secure-storage.json`, `packages/app/src/app/core/host/secure-storage.service.ts`, `packages/app/src/app/core/state/live.store.ts`, `packages/app/src/app/core/api/check.client.ts`, `packages/app/src/app/core/api/push.client.ts`, `tests/app/cli-parity.spec.ts`, `tests/app/secure-storage.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Settings: API key de Postman guardada vía `tauri-plugin-stronghold` o `keyring` crate (Keychain/Credential Manager/Secret Service); UI muestra "••••••••" + "Stored securely on this device" + opción "Use for this session only" (memoria, no persistente)"
  - "Push-to-Postman desde GUI: workspace selector + dry-run preview; errores de Postman API se mapean a diagnostics estructurados (no toast genérico); rate limit con retry exponencial y mensaje claro"
  - "Live mode (toolbar toggle): muestra "Watching N source files"; cambios emiten notification con operaciones añadidas/modificadas/eliminadas; auto-export opt-in separado del watch (default off)"
  - "Check/Sync/Validate accesibles desde sidebar; cada uno muestra diagnostics estructurados (severity, code, file:line, suggestion) — no texto libre; navegación keyboard completa"
  - "CLI commands siguen siendo la fuente de verdad: cada feature de GUI tiene un comando CLI equivalente documentado en `docs/CLI.md` con ejemplos"
  - "Capabilities file separado (`secure-storage.json`) para los permisos de stronghold/updater — Tauri mergea los archivos"
  - "Tests: `cli-parity.spec.ts` cubre cada feature desde la GUI; `secure-storage.spec.ts` cubre save/retrieve/delete con keyring mock"
  - "DoD slice: `bun run typecheck && bun run test:app && cargo check && bun run validate:examples` verdes"

## acceptance

- `packages/app/` compila standalone components + signals (Angular 17+); sin Angular Material; `@angular/cdk` para overlay, focus trap, virtual scroll, a11y
- Design tokens: cobre sobrio (light #F7F7F5 bg / #17191C text / cobre oscuro accent; dark #101214 bg / #F2F3F3 text / cobre claro accent); system-ui para UI; ui-monospace/SFMono-Regular/Cascadia Mono/Consolas para code; spacing base 4; radios 6/8/10/12 (input/button/panel/dialog); motion `cubic-bezier(.2,.8,.2,1)` 90-120ms hover / 150-170ms view transition / 180-200ms dialog
- Command palette ⌘K/Ctrl+K con 8 acciones (open, rescan, search, export, settings, help, theme, recent); filtro fuzzy; keyboard-only navigation
- i18n: `en.json` reference (canonical), `es.json` complete (traducción real, distinto del reference en al menos 50% de keys comunes); `experimental` solo para locales en progreso
- Sidebar con Overview/Endpoints/Schemas/Services/Exports/History/Diagnostics/Settings; navegación keyboard 100% (Tab/flechas/Enter)
- `apisrc ui` sirve `packages/app/dist/` como artefacto único; Tauri empaqueta el mismo dist — single source of UI
- Tests: `tests/app/shell.spec.ts` cubre render del shell + command palette (8 acciones) + i18n switch + theme switch (sin flashes)
- DoD slice: `bun run typecheck && bun run test:app && bun run build:app` verdes
- Tauri dialog plugin instalado (`tauri-plugin-dialog`); capability grant en `capabilities/main.json`; abrir proyecto abre `NSOpenPanel` (macOS), `IFileOpenDialog` (Windows), `XDG Portal` chooser (Linux)
- Drag&drop: Tauri `WindowEvent::DragDrop` propagado al webview; drop zone visual con highlight; soltar carpeta = trigger `openProject(path)`
- Recents: últimos 10 proyectos persistidos en settings local (workspace-scoped, sin secretos); panel de Settings permite olvidar uno o todos; orden por last-opened
- `apisrc ui` (browser): cuando el host bridge es HTTP (no stdio), usa `/api/browse` como fallback; modal con breadcrumbs + keyboard navigation + parent + truncated long lists + permisos (symlinks excluidos); la UX es equivalente al native picker en lo que el browser permite
- Field de "pegar ruta manualmente" relegado a `Advanced` collapsed section; nunca es la primera acción visible
- Empty state inicial: "Tus APIs" + CTA "Abrir un proyecto…" + drop zone + recents — sin pedir ruta en texto
- `Cargo.toml` añade TODAS las dependencias Tauri que la propuesta necesita (dialog, stronghold/keyring, updater) en este slice — los Rust crates se declaran aunque su uso llegue en S6; evita solapamiento entre slices
- Tests: `folder-picker.spec.ts` cubre native dialog invocation (mock), drag&drop event, recents add/remove/clear; `recent-projects.spec.ts` cubre persistencia + ordering + forget-one + forget-all
- DoD slice: `bun run typecheck && bun run test:app && cargo check` verdes
- Lista virtual scroll (`@angular/cdk` `cdk-virtual-scroll-viewport`) soporta 5k+ operations sin lag perceptible (60fps scroll); filtros combinables por service/framework/transport/method/auth/has-validation/has-responses/confidence/source-file + search fuzzy en path+method+description
- Detail panel con tabs Overview/Request/Responses/Validation/Auth/Evidence/Source; `TransportInspectorDirective` adapta el render: HTTP muestra method+path+headers+query+body; gRPC muestra service+rpc+streaming+request/response types; GraphQL muestra operationType+operationName+variables+schema; WS muestra namespace+event+direction+payload; SSE muestra stream+event+payload; broker muestra broker+channel+direction+message
- Click en diagnostic (e.g. "8 operations have no validation") aplica el filtro correspondiente; URL query param sincronizado con el state para deep-link
- Schema viewer para request/response bodies: JSON Schema → tree view con tipos, descripciones, examples; unfold por niveles; copy al clipboard del path JSON
- Code snippet read-only con syntax highlight (highlight.js o Prism vía npm); botones "Open in editor" (Tauri `tauri-plugin-shell` → `open` con VSCode/Cursor URL) y "Copy location" (`file:line:col`)
- Tests: `endpoints.spec.ts` cubre render de 5k items, filtros combinados, detail panel por transport (uno por cada uno de los 6 transports), Evidence tab, drag-to-resize del split entre list y detail
- DoD slice: `bun run typecheck && bun run test:app` verdes; smoke e2e con proyecto fixture NestJS abre Endpoints Explorer sin re-scan (usa ProjectSession de `f00016`)
- Export Center lista formatos con capabilities declaradas (consume `ExportCapabilities` de `r00019` S4): Postman, OpenAPI 3.1, Insomnia v4, Bruno, HAR, cURL — cada uno con counts honestos (e.g. "OpenAPI: 72/84 operations; 12 GraphQL operations cannot be represented as path+method")
- Dry-run preview muestra archivos `NEW`/`UPDATE`/`UNCHANGED` + warning explícito si va a sobrescribir archivos no generados por Tanit; botón Generate deshabilitado hasta aceptar el preview
- Diagnostics estructurados (`ExportDiagnostic { code, severity, operationIds[], message, suggestion }`) con severity icon (info/warning/error), código clickeable que filtra Endpoints Explorer; ningún exporter emite warning genérico sin código
- Success state: "Open folder" (Tauri `shell.open`) + "Open Postman" (`postman://` protocol url, con fallback si no instalado) + "Copy paths"
- Output dir editable vía native dialog; muestra ruta relativa al proyecto (e.g. `./tanit/`) + ruta absoluta; validation: dentro del workspace o pide confirmación si fuera
- Tests: `export-center.spec.ts` cubre selección/deselección de formatos, dry-run con preview, generate con/sin overwrite, success con 0/1/N diagnostics
- DoD slice: `bun run typecheck && bun run test:app && bun run validate:examples` verdes
- Services screen lista cada service con framework/transport/auth/baseUrl/operationCount; service detail muestra breakdown por transport + per-operation serverRef/authRef (consume `IOperation.serverRef`/`authRef` de `r00019`)
- UI marca "Combined export" como partial + recomienda "Export each service separately" mientras per-operation serverRef no esté garantizado en todos los exporters (badge con tooltip explicativo)
- History graba snapshot-hash por run (`SHA-256` del canonical JSON del snapshot); cada entry: timestamp, formats, operationCount, snapshotHash, outputDir
- History Diff: entre dos runs, muestra `+N operations`/`-M operations`/`~K schemas changed`/`~J auth changed` — no "auth changed globally" sino por servicio y operación
- Acciones desde diff: "Re-export with this config" / "Compare config" / "Restore settings"
- Tests: `services.spec.ts` cubre multi-service con auth/baseUrl distintos (consume `tests/fixtures/multi-service/` de `r00019` S3); `history.spec.ts` cubre diff entre dos runs con cambios detectados correctamente
- DoD slice: `bun run typecheck && bun run test:app` verdes
- Settings: API key de Postman guardada vía `tauri-plugin-stronghold` o `keyring` crate (Keychain/Credential Manager/Secret Service); UI muestra "••••••••" + "Stored securely on this device" + opción "Use for this session only" (memoria, no persistente)
- Push-to-Postman desde GUI: workspace selector + dry-run preview; errores de Postman API se mapean a diagnostics estructurados (no toast genérico); rate limit con retry exponencial y mensaje claro
- Live mode (toolbar toggle): muestra "Watching N source files"; cambios emiten notification con operaciones añadidas/modificadas/eliminadas; auto-export opt-in separado del watch (default off)
- Check/Sync/Validate accesibles desde sidebar; cada uno muestra diagnostics estructurados (severity, code, file:line, suggestion) — no texto libre; navegación keyboard completa
- CLI commands siguen siendo la fuente de verdad: cada feature de GUI tiene un comando CLI equivalente documentado en `docs/CLI.md` con ejemplos
- Capabilities file separado (`secure-storage.json`) para los permisos de stronghold/updater — Tauri mergea los archivos
- Tests: `cli-parity.spec.ts` cubre cada feature desde la GUI; `secure-storage.spec.ts` cubre save/retrieve/delete con keyring mock
- DoD slice: `bun run typecheck && bun run test:app && cargo check && bun run validate:examples` verdes
