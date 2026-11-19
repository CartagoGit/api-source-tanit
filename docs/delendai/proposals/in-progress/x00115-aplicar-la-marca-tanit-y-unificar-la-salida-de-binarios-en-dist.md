---
id: x00115
title: "Aplicar la marca Tanit y unificar la salida de binarios en dist"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-19
---

# x00115 — Aplicar la marca Tanit y unificar la salida de binarios en dist

## goal

Reutilizar los assets de Tanit en CLI, web, escritorio y ejecutables con una carpeta de distribución única.

## why

La web usa una letra provisional, no hay favicon y la compilación desde WSL deriva el binario a Descargas públicas.

## non-goals

- Publicar una release ni modificar el historial de ExpOstman.

## slices

- global_gate: lint

### S1 — Integrar assets, iconos y carpeta de distribución
- **Status**: pending
- **Files**: `assets/icons/tanit.svg`, `assets/images/tanit-banner.png`, `README.md`, `angular.json`, `package.json`, `bun.lock`, `docs/INSTALL.md`, `docs/delendai/AGENT-BOOTSTRAP.md`, `scripts/gates/lint-root-allowlist.script.ts`, `scripts/build/brand-assets.script.ts`, `scripts/build/build-binary.script.ts`, `scripts/build/windows-binary-icon.helper.ts`, `packages/app/src/index.html`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/desktop/tauri.conf.json`, `packages/desktop/icons/icon.png`, `packages/desktop/icons/icon.ico`, `packages/desktop/icons/icon.icns`, `packages/cli/cli.script.ts`, `packages/ui/web/tanit-brand.generated.ts`, `packages/ui/web/index.html.constant.ts`, `packages/ui/server/ui-server.service.ts`, `tests/cli/compiled-binary.test.ts`
- **Gate**: e2e
- acceptance:
  - "El logo de los assets aportados sirve de favicon y se muestra en Angular, Tauri y la web integrada; la ayuda raíz del CLI muestra su representación ASCII."
  - "El ejecutable de Windows y los paquetes de escritorio usan los iconos de Tanit; la CLI conserva su arranque y exportación."
  - "Los scripts de binarios y UI usan dist por defecto en todas las plataformas, incluido WSL, y conservan --out para rutas explícitas."

## acceptance

- El logo de los assets aportados sirve de favicon y se muestra en Angular, Tauri y la web integrada; la ayuda raíz del CLI muestra su representación ASCII.
- El ejecutable de Windows y los paquetes de escritorio usan los iconos de Tanit; la CLI conserva su arranque y exportación.
- Los scripts de binarios y UI usan dist por defecto en todas las plataformas, incluido WSL, y conservan --out para rutas explícitas.
