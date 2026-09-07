---
id: a00019
title: "Auditoría 2026-09-07 — consolidación post-158 propuestas y plan de productización Tanit"
kind: audit
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
---

# a00019 — Auditoría 2026-09-07 — consolidación post-158 propuestas y plan de productización Tanit

## Goal

Documentar el estado real del proyecto al cierre del ciclo de 158 propuestas (154 done + 4 retired) y consolidar el backlog de excelencia restante en una propuesta padre que cubre seis bloques: (a) hygiene crítica (CI verde, branch protection, cobertura, fixtures, monkey-patches), (b) desacople de Postman (Universal API Model v2, discriminated unions por transport, OperationId estable, per-operation serverRef/authRef), (c) ProjectSession + ProjectIndex + Application API para eliminar re-scans y soportar watch incremental, (d) nueva aplicación Angular desktop con selector nativo de carpetas, Endpoints Explorer, Export Center, History-diff y paridad completa con el CLI, (e) precision multi-lenguaje (Module resolver completo, LanguageIR progresivo para Python/PHP/Go/Java/C#/Ruby/Elixir/Rust), (f) release industrial (desktop CI por plataforma, firma/notarización, secure storage, updater firmado, SBOM). Cada fase se entrega como propuesta hija con Slices independientes siguiendo el contrato canónico (lint:proposals).

## why

El agente externo que revisó el repositorio en develop (HEAD ae6e284…) confirma que las 158 propuestas anteriores consolidaron los cimientos: contracts→core→frameworks→composition es una arquitectura sana, los 25 IDs detectables viven en un registry único, los 6 exporters son puros y consumen el modelo intermedio, `apisrc ui` tiene ingeniería de seguridad de primera (loopback + token + Origin), y la base Tauri mantiene main.rs como shell fino. Sin embargo identificó seis bloques de deuda que separan el proyecto de ser un producto: (1) hygiene crítica todavía rota (CI rojo en lint/coverage/validate-examples, develop sin protección, package.json/registry/README/Tauri bundle cuentan 21 cuando hay 25 detectores, console.log + process.env monkey-patches en generate), (2) Tanit sigue siendo Postman-céntrico por dentro (EndpointSpec vive en postman.interface.ts, generation pipeline describe projectRoot→PostmanCollection), (3) combineServices hereda baseUrl/auth/variables del primer servicio en monorepos multi-servicio, (4) TransportKind todavía acepta `| string` y tiene opcionales absurdos (un grpc sin service+method), (5) la inferencia de responses solo cubre 4 frameworks (Spring, NestJS, FastAPI, ASP.NET) cuando hay ~20 lenguajes con modelos de salida explícitos, (6) module-resolver solo entiende imports relativos y fallback .ts/.tsx/.js/index.* (sin tsconfig baseUrl/paths, sin package.json exports/imports, sin monorepo workspaces, sin Windows drive letters/UNC), (7) Tanit Desktop todavía pide una ruta de texto cuando los 3 OS tienen selectores nativos y drag&drop; no usa secure storage para el API key de Postman; CI no valida el Rust/sidecar. Resolver todo esto convierte Tanit en un developer tool de primer nivel; añadir más scanners sin resolverlo perpetúa la deuda.

## non-goals

- Reescribir Tanit desde cero — los cimientos arquitectónicos (a00012, a00013, a00016, r00013, r00014, r00016, f00013) se conservan tal cual.
- Añadir nuevos frameworks/lenguajes/protocolos — la fase 6 introduce LanguageIR para más lenguajes pero solo con la profundidad ya existente en TS; un Python completo con tipos mypy es trabajo posterior.
- Convertir Tanit en un SaaS multi-tenant — sigue siendo local-first; el secure storage es por-device, no por-usuario.
- Sustituir el CLI por la GUI — la CLI sigue siendo la fuente de verdad; la GUI consume el mismo Application API.
- Migrar de Tauri a Electron/Tauri 2.0 — Tauri actual se mantiene, los nuevos capabilities (secure storage, updater, dialogs nativos) entran via el plugin oficial.

## Slices

- global_gate: e2e

### phase-1-hygiene-ci — Fase 1 — Higiene crítica + branch protection real + fixtures + coverage
- **Status**: pending
- **Files**: `docs/delendai/proposals/ready/chores/c00010-higiene-critica-ci-verde-branch-protection-real-cobertura-80-fixtures-reparadas-monkey-patches-eliminados.md`
- **Gate**: e2e
- acceptance:
  - "c00010 cerrado y archivado: CI verde end-to-end, develop protegido con required checks, fixtures reparadas, coverage ≥ 80% global"
  - "INDEX.md regenerado y commiteado"
  - "El DoD de a00019 se cumple para el bloque (a)"
- review-state: in_review
- review-implementer: orchestrator-cartago-2026-09-07
- review-log: requested_changes by delivery-verifier-20260908 — la aceptación phase-1-hygiene-ci exige 'c00010 cerrado y archivado' pero c00010 permanece en in-progress/ con S3 parcial. Bloqueos verificados por el implementer sobre HEAD fda5835: (1) scripts/gates/coverage.script.ts ausente (error: Module not found al ejecutar el gate); (2) tests/coverage-baseline.json ausente; (3) vitest.config.ts declara un único threshold global (statements:73, branches:70, functions:82, lines:75), no los per-proyecto (global ≥ 80%, core ≥ 90%, frameworks ≥ 75%, cli ≥ 70%) que exige S3 acceptance; (4) lint:proposals sigue rojo por 16 propuestas en done/<kind> con kind incorrecto (deuda previa, NO introducida por c00010). Decisión: c00010 NO cierra, slice phase-1-hygiene-ci NO se aprueba, queda in_review con blockers documentados en el doc canónico. El implementer ha hecho trabajo honesto: actualizó c00010 con Trazabilidad 2026-09-08 explícita y revirtió review-state de in_review (premauro de la sesión previa) a in_progress. El próximo paso es una nueva slice que aterrice los 3 entregables de S3: coverage.script.ts, coverage-baseline.json, y thresholds per-proyecto en vitest.config.ts — preferiblemente como c00010 S3-prórroga o como una nueva c00011 con archivos disjuntos.
### phase-2-universal-api-model — Fase 2 — Universal API Model v2: OperationId universal, per-operation serverRef/authRef, Postman como exporter más
- **Status**: pending
- **DependsOn**: [phase-1-hygiene-ci]
- **Files**: `docs/delendai/proposals/ready/refactors/r00019-universal-api-model-v2-operationid-universal-per-operation-serverref-authref-postman-como-exporter-mas.md`
- **Gate**: e2e
- acceptance:
  - "r00019 cerrado: TransportKind es discriminated union; OperationId universal; per-operation serverRef/authRef; combineServices ya no hereda del primer servicio; PostmanExporter consume IProjectSnapshot como los demás"
  - "El DoD de a00019 se cumple para el bloque (b)"

### phase-3-project-session-index — Fase 3 — ProjectSession + ProjectIndex + Application API host-agnostic
- **Status**: pending
- **DependsOn**: [phase-2-universal-api-model]
- **Files**: `docs/delendai/proposals/ready/feats/f00016-projectsession-projectindex-application-api-un-scan-por-proyecto-snapshot-inmutable-bridge-host-agnostic.md`
- **Gate**: e2e
- acceptance:
  - "f00016 cerrado: ProjectSession open() una vez por proyecto; ProjectIndex cachea files/AST/manifests; Application API host-agnostic con bridge stdio (Desktop) y HTTP preservado (browser)"
  - "El DoD de a00019 se cumple para el bloque (c)"

### phase-4-desktop-app — Fase 4 — Nueva aplicación Angular Desktop: shell, folder picker, Endpoints Explorer, Export Center, History diff, paridad CLI
- **Status**: pending
- **DependsOn**: [phase-3-project-session-index]
- **Files**: `docs/delendai/proposals/ready/feats/f00017-tanit-desktop-angular-app-selector-nativo-de-carpetas-endpoints-explorer-export-center-history-diff-paridad-cli-secure-storage.md`
- **Gate**: e2e
- acceptance:
  - "f00017 cerrado: packages/app compila, design system tokens.scss, folder picker nativo + drag&drop, Endpoints Explorer con virtual scroll, Export Center con capabilities, History diff, Live mode, push-to-Postman con secure storage"
  - "El DoD de a00019 se cumple para el bloque (d)"

### phase-5-multi-language-precision — Fase 5 — Multi-lenguaje precision: ModuleResolver completo, LanguageIR foundation, response inference expandida
- **Status**: pending
- **DependsOn**: [phase-4-desktop-app]
- **Files**: `docs/delendai/proposals/ready/refactors/r00020-multi-lenguaje-precision-moduleresolver-completo-languageir-foundation-agnostica-response-inference-expandida-4-10-inferrers.md`
- **Gate**: e2e
- acceptance:
  - "r00020 cerrado: ModuleResolver entiende tsconfig paths, package.json exports/imports, workspaces, Windows paths; LanguageIR conceptual agnóstico del lenguaje (TS migrado); barrel de response-inference de 4 → 10 inferrers"
  - "El DoD de a00019 se cumple para el bloque (e)"

### phase-6-industrial-release — Fase 6 — Release industrial: desktop CI por plataforma, signing/notarization, secure updater, SBOM
- **Status**: pending
- **DependsOn**: [phase-5-multi-language-precision]
- **Files**: `docs/delendai/proposals/ready/infras/i00003-release-industrial-desktop-ci-por-plataforma-signing-notarization-secure-updater-firmado-sbom-cyclonedx-checksums-firmados.md`
- **Gate**: e2e
- acceptance:
  - "i00003 cerrado: desktop CI verde en macOS/Windows/Linux; signing + notarization macOS, Authenticode Windows, checksums firmados Linux; updater firmado; SBOM CycloneDX en cada release; SECURITY.md documenta threat model"
  - "El DoD de a00019 se cumple para el bloque (f)"

## acceptance

- x00072 cerrado y archivado: CI verde end-to-end, develop protegido con required checks, fixtures reparadas, coverage ≥ 80% global
- INDEX.md regenerado y commiteado
- El DoD de a00019 se cumple para el bloque (a)
- r00019 cerrado: TransportKind es discriminated union; OperationId universal; per-operation serverRef/authRef; combineServices ya no hereda del primer servicio; PostmanExporter consume IProjectSnapshot como los demás
- El DoD de a00019 se cumple para el bloque (b)
- f00016 cerrado: ProjectSession open() una vez por proyecto; ProjectIndex cachea files/AST/manifests; Application API host-agnostic con bridge stdio (Desktop) y HTTP preservado (browser)
- El DoD de a00019 se cumple para el bloque (c)
- f00017 cerrado: packages/app compila, design system tokens.scss, folder picker nativo + drag&drop, Endpoints Explorer con virtual scroll, Export Center con capabilities, History diff, Live mode, push-to-Postman con secure storage
- El DoD de a00019 se cumple para el bloque (d)
- r00020 cerrado: ModuleResolver entiende tsconfig paths, package.json exports/imports, workspaces, Windows paths; LanguageIR conceptual agnóstico del lenguaje (TS migrado); barrel de response-inference de 4 → 10 inferrers
- El DoD de a00019 se cumple para el bloque (e)
- i00002 cerrado: desktop CI verde en macOS/Windows/Linux; signing + notarization macOS, Authenticode Windows, checksums firmados Linux; updater firmado; SBOM CycloneDX en cada release; SECURITY.md documenta threat model
- El DoD de a00019 se cumple para el bloque (f)
