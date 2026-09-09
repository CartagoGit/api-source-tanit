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
- **Status**: done
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
- review-state: done
- review-implementer: technical-investigator
- review-reviewer: proposal-guardian
- review-log: requested_changes by delivery-verifier — Solicito cambios antes de aprobar. Hallazgos bloqueantes: (1) el folder picker nativo no está realmente registrado: packages/desktop/src/main.rs solo declara mod bridge/mod sidecar y solo inicializa tauri_plugin_shell; no declara dialogs.rs/drag_drop.rs, no inicializa tauri_plugin_dialog y no propaga WindowEvent::DragDrop al webview. packages/desktop/Cargo.toml solo declara tauri-plugin-shell, falta tauri-plugin-dialog. La capability packages/desktop/capabilities/main.json declara dialog:default, pero sin dependencia + plugin registrado no habilita el runtime; el frontend invoke no puede reparar esto. (2) build:app falla: packages/app/src/app/features/home/recent-projects.component.ts:12 usa project.path.split(/[\\/]/) dentro de una expresión Angular, que produce NG5002 (Unexpected character/token). Debe mover la derivación a un método/pipe/valor compatible con template y rerun build:app. (3) DragDropService escucha tauri://drag-drop, pero main.rs no registra ningún listener/forward de WindowEvent::DragDrop, así que el flujo Tauri no está conectado aunque el adaptador exista. (4) La lista declarada de S2 no incluye main.rs ni Cargo.toml, aunque la aceptación exige instalación/registro nativo; agregarlos explícitamente a Files/ownership o declarar una dependencia que los entregue antes de cerrar S2. También deben actualizarse los tests/integración para demostrar el wiring, no solo los tests unitarios del servicio. Validaciones ejecutadas: bun run typecheck --if-present PASS (6 secciones); bun run test:app PASS (3 archivos/10 tests); bunx vitest run --project app tests/app/folder-picker.spec.ts PASS (2/2); bun run build:app FAIL con NG5002 en recent-projects.component.ts:12; cargo check/test --manifest-path packages/desktop/Cargo.toml no ejecutables porque cargo no está instalado en el entorno; git diff --check PASS.
- review-log: requested_changes by delivery-verifier-r2-20260908 — No aprobar fa4718b todavía. Bloqueo reproducible: packages/app/src/app/core/host/drag-drop.service.ts escucha el evento Tauri `tauri://drag-drop`, pero packages/desktop/src/main.rs no registra ningún forwarding de WindowEvent::DragDrop al webview; el módulo drag_drop.rs solo contiene una función auxiliar y no está conectado al ciclo de eventos. Por tanto, el drag/drop nativo no puede emitir rutas al frontend aunque el servicio Angular exista. Debe añadirse el wiring nativo (o cambiar el contrato para usar el mecanismo real de Tauri) y tests/integración que demuestren el flujo. Validaciones de esta revisión: bun run build:app PASS; bun run test:app PASS (3 archivos, 10 tests); bun run scripts/gates/typecheck.script.ts app PASS; git diff fa4718b^ fa4718b --check PASS. Cargo no está disponible en el entorno (`command -v cargo` sin resultado), por lo que no fue posible ejecutar cargo check/test. El árbol de trabajo tenía cambios ajenos previos; no se modificó ningún archivo.
- review-log: approved by proposal-guardian — Revisión actual del rango fa4718b^..fb1f791 sin defectos reproducibles. Validaciones: bun run build:app PASS; bun run test:app PASS (3 archivos, 10/10 tests); bunx tsc --noEmit -p tsconfig.app.json PASS; git diff --check PASS; Cargo no está instalado. packages/desktop/Cargo.toml declara tauri-plugin-dialog = "2"; packages/desktop/src/main.rs declara mod dialogs/mod drag_drop y registra tauri_plugin_dialog::init(); tauri.conf.json tiene app.withGlobalTauri=true; capabilities/main.json incluye dialog:default; Angular adapters usan globalThis.__TAURI__ y escuchan tauri://drag-drop. No se exige forwarding manual: Tauri v2 emite ese evento automáticamente.
### S3-endpoints-explorer — S3 — Endpoints Explorer virtualizado, filtros combinables y detail transport-aware
- **Status**: done
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
- review-state: done
- review-implementer: orchestrator
- review-reviewer: proposal-guardian
- review-log: requested_changes by delivery-verifier — Request changes. Los gates solicitados pasan: bun run test:app (4 archivos, 15/15 tests), bun run scripts/gates/typecheck.script.ts app, bun run build:app y git diff --check. Pero hay defectos reproducibles contra la aceptación de S3: (1) packages/app/src/app/shared/virtual-scroll/virtual-scroller.component.ts implementa un virtualizador manual; no usa @angular/cdk ni cdk-virtual-scroll-viewport, incumpliendo explícitamente el requisito del slice. (2) packages/app/src/app/features/endpoints/schema-viewer.component.ts renderiza JSON.stringify en <pre>; no ofrece un visor de schema en árbol como exige la aceptación. (3) La ruta de diagnostics-to-filter no modela diagnostics: EndpointRecord no tiene diagnostics/codes y endpoint-detail emite item.transport mediante tanitTransportInspector, por lo que al pulsar el bloque transport solo filtra por transport, no por el código de un diagnostic. (4) La búsqueda es substring sobre path/method/description, no fuzzy search; el test existente no distingue fuzzy de contains. Corregir estos puntos y añadir tests específicos de CDK viewport, árbol de schema y diagnostic code-to-filter antes de volver a solicitar aprobación. No se editó ningún archivo ni se cerró metadata.
- review-log: approved by proposal-guardian — Revisión independiente de 8aff1f4: build:app, test:app 15/15, typecheck app y diff-check verdes. Verificados CDK virtual scroll real, schema tree recursivo, diagnostics con code, fuzzy search, deep-link completo, separación transporte/diagnostic y test del wrapper CDK.
### S4-export-center-capabilities — S4 — Export Center, capabilities, dry-run, overwrite guard y diagnostics
- **Status**: done
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
- review-state: done
- review-implementer: orchestrator
- review-reviewer: proposal-guardian
- review-log: requested_changes by delivery-verifier — Request changes. Gates solicitados: `bun run test:app` pasa (5 archivos, 20/20 tests), `bun run scripts/gates/typecheck.script.ts app` pasa, `bun run build:app` pasa y `git diff --check` pasa. Defectos reproducibles frente a la aceptación de S4: (1) `ExportsClient.dryRun()` solo puede devolver `NEW` o `UPDATE`; no existe ninguna ruta para `UNCHANGED`, por lo que el requisito de mostrar los tres estados no está implementado. (2) `UPDATE`/overwrite se decide con `outputDirectory.includes("existing")`, no inspeccionando archivos reales ni su contenido: `/workspace/existing-data` se marca como UPDATE aunque no exista y una carpeta real con otro nombre se marcaría NEW; el overwrite guard no es fiable. (3) `outsideWorkspace` usa `outputDirectory.startsWith(workspaceRoot)`, de modo que `/workspace-evil/out` se considera dentro de `/workspace`; debe usar containment por segmentos/ruta normalizada. (4) `generate()` no genera ni escribe artefactos Postman/OpenAPI 3.1/Insomnia/Bruno/HAR/cURL: solo devuelve una promesa con previews, así que las seis capacidades son etiquetas/counts sintéticos y no hay exportación real que validar. (5) Los diagnostics solo se crean para `endpointCount === 0`; no hay soporte para cero/uno/varios diagnostics reales por operación, ni validación de códigos/sugerencias derivados de los endpoints. (6) Las acciones de éxito abren URLs `tanit://` directamente desde el componente y no pasan por ports nativos/fallback operativo; `postmanInstalled` siempre es false. (7) La prueba aislada `bun test tests/app/export-center.spec.ts` falla antes de ejecutar tests por el parche de `zone.js` (`originalJestFn.each` undefined); la suite agregada `test:app` pasa, pero conviene estabilizar la ejecución focalizada o documentar la configuración requerida.
- review-log: requested_changes by proposal-guardian — Request changes. Los cuatro gates solicitados pasan: `bun run test:app` (5 archivos, 22/22 tests), `bun run scripts/gates/typecheck.script.ts app`, `bun run build:app` y `git diff --check`. Sin embargo, la integración del Export Center no satisface la aceptación: `ExportsClient` soporta `existingFiles` y `operations`, pero `ExportsStore.request()` no los proporciona y el store no expone ninguna carga/derivación para ellos. En la UI real, por tanto, `dryRun()` solo recibe `endpointCount` y genera siempre contenido sintético: no puede detectar `UPDATE`/`UNCHANGED` comparando archivos existentes ni mostrar diagnostics derivados de operaciones; solo aparece `NO_ENDPOINTS` para cero endpoints. Añadir el flujo de datos real desde el snapshot/bridge hacia el store y pruebas de componente que demuestren `UPDATE`, `UNCHANGED` y diagnostics de una o varias operaciones en la pantalla. No se editaron archivos ni metadata.
- review-log: requested_changes by technical-investigator — No aprobar ec8b335 todavía. Aunque pasan las validaciones solicitadas (bunx vitest run --project app tests/app/export-center.spec.ts: 8/8; bun run test:app: 23/23; typecheck app; build:app; git diff HEAD^ HEAD --check), hay defectos reproducibles frente a la aceptación de S4: (1) ExportSuccessActions.openFolder() y openPostman() abren URLs tanit:// directamente mediante window.open desde packages/app/src/app/features/exports/export-center.component.ts; no invocan un port/adaptador nativo ni implementan fallback operativo cuando Postman no está instalado, y ExportResult.postmanInstalled está fijado siempre a false. (2) El formato Bruno no genera un artefacto Bruno verificable: se escribe tanit-bruno.json con un esquema genérico {version,name,requests}, mientras que la aceptación exige artefactos verificables de los seis formatos; el test solo comprueba la cadena requests y no valida una colección Bruno real. Añadir adapters/ports y fallback comprobable, detectar postmanInstalled, y generar/validar el formato Bruno real con tests específicos.
- review-log: approved by proposal-guardian — Aprobación independiente del commit 38f6e50. Gates verdes: bunx vitest run --project app tests/app/export-center.spec.ts (9/9), bun run test:app (24/24), bun run scripts/gates/typecheck.script.ts app, bun run build:app y git diff HEAD^ HEAD --check. Verificados operations/existingFiles en ExportsStore; NEW/UPDATE/UNCHANGED por igualdad de contenido; containment por segmentos; artefactos Postman, OpenAPI 3.1, Insomnia v4, Bruno .bru con bloques meta/get, HAR y cURL mediante writer; diagnostics por operación; confirmaciones; y prioridad de __TAURI__.invoke con fallback web.
### S5-services-and-history-diff — S5 — Services, historial canónico y diff visual por operación/servicio
- **Status**: done
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
- review-state: done
- review-implementer: orchestrator
- review-reviewer: technical-investigator
- review-log: requested_changes by delivery-verifier — Request changes. Gates: bun run test:app 28/28, typecheck app PASS, build:app PASS, git diff --check PASS. No se editaron archivos ni metadata. Defectos reproducibles: ServicesClient.detail llama a list-services y filtra en memoria; IServiceOperation no declara ni renderiza serverRef/authRef. El diff solo devuelve claves string, no valores before/after ni detalle por servicio/operacion: al cambiar schema y auth devuelve schemaChanges [operation:s/op] y authChanges [operation:s/op,service:s]. No existe compareConfig y reExport no acepta configuracion; solo emite history-re-export con projectRoot/historyId y history-restore con projectRoot/historyId. La UI Compare/Re-export/Restore no ofrece configuracion, confirmacion, errores visibles ni restauracion de settings/provenance verificable. El export combinado no implementa partial: ExportDryRun/ExportResult no tienen partial, dryRun no recibe services ni referencias por operacion. Las pruebas S5 son solo 2 de services y 2 de history; no cubren multi-service divergente, refs, diff detallado, combined partial, compare config, re-export config, restore settings ni provenance tras restore. SHA-256 determinista ante reordenacion y provenance basico source/projectRoot/parentId si pasan.
- review-log: requested_changes by proposal-guardian — Request changes. Los cuatro gates solicitados pasan: `bun run test:app` (7 archivos, 31/31 tests), `bun run scripts/gates/typecheck.script.ts app`, `bun run build:app` y `git diff --check`. No se editó ningún archivo ni metadata y no se aporta evidence porque S5 no tiene commit. Defectos reproducibles frente a la aceptación: (1) La UI de History no ofrece compare config ni configuración editable de re-export/restore settings: HistoryDiffComponent solo ejecuta compare con `{ outputDirectory: "" }`, no llama compareConfig y no renderiza controles/acciones para re-export configurable o restore settings; HistoryListComponent fuerza `{ formats: ["postman"] }` al re-exportar. (2) Restore solo confirma con `globalThis.confirm` y muestra `historyId`/source; no presenta settings restaurados ni provenance completa, y no hay manejo visible específico de error para esas acciones más allá del store general. (3) `combinedExport.partial` está declarado en `ICanonicalSnapshot`, pero no forma parte de `ExportDryRun`/`ExportResult`, `ExportRequest` ni del flujo de ExportsStore/ExportCenter; por tanto no se marca ni explica un combined export parcial en la UI ni se derivan referencias por operación desde exportación. (4) Los tests de S5 pasan pero no cubren los flujos UI faltantes: no hay pruebas de compare-config, configuración editable de re-export, restore settings/provenance visible ni combinedExport.partial integrado. La API y el diff core sí contienen mejoras válidas: `ServicesClient.detail` usa `service-detail`, las operaciones exponen `serverRef`/`authRef`, y los cambios incluyen before/after detallado.
- review-log: approved by technical-investigator — Revisión fresca de la ronda posterior al commit 1acb5e6. Evidencia: commit publicado en origin/develop; tests focalizados 19/19; suite app 34/34; typecheck app PASS; build app PASS; git diff --check PASS. El implementador de esta ronda fue orchestrator y el reviewer es distinto de implementador y de los reviewers anteriores.
### S6-cli-parity-secure-storage-live — S6 — Paridad CLI, Live mode, secure storage y push-to-Postman
- **Status**: done
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
- review-state: done
- review-implementer: delendai-impl-20260908-s6
- review-reviewer: proposal-guardian-20260908
- review-log: requested_changes by technical-investigator-20260908 — Revisión independiente: los checks app pasan (test:app 39/39, build:app PASS, validate:examples 25/25 válidos, diff-check PASS), pero no apruebo S6. Bloqueos reproducibles: (1) packages/desktop/src/secure_storage.rs implementa un HashMap en memoria y no usa keyring; además no está conectado desde Cargo.toml/main.rs ni expone comandos Tauri, por lo que no cumple Keychain/Credential Manager/Secret Service. (2) HostBridgeClient sigue siendo un stub y PushClient descarta workspace, dryRun y cancelación al llamar `push`, así que GUI no comparte realmente el handler CLI/API ni demuestra retry efectivo ante 429. (3) sync --dry-run delega a `--inspect`, pero no existe prueba de ejecución ni output compatible CLI/GUI. (4) typecheck:cli falla por dos errores ajenos en packages/core/session/snapshot-hash.service.ts; cargo no está disponible. Solicito cambios o declarar explícitamente estos blockers mediante dependencia/ownership antes de cerrar S6.
- review-log: approved by proposal-guardian-20260908 — Revisión independiente del rango a7637ba..1a4eb81. Evidencia ejecutada: typecheck app PASS, typecheck cli PASS, test:app 39/39, build:app PASS, validate:examples 25/25 válidos con 2 avisos conocidos, git diff --check PASS. Verificado: sync reutiliza runGenerate sin segunda pipeline; CLI docs incluyen check/sync/validate/push/live; browser secure storage es memoria-only y Desktop usa keyring con comandos Tauri; HostBridgeClient usa JSON-RPC Tauri/browser; live store mantiene auto-export off por defecto y eventos de cambios; push redacts y reintenta rate-limit. Cargo check no fue ejecutable porque cargo no está instalado. Aprobación condicionada únicamente a ese prerrequisito ambiental no disponible.
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
