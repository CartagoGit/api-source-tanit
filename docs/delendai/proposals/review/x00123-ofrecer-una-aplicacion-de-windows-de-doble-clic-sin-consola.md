---
id: x00123
title: "Ofrecer una aplicación de Windows de doble clic sin consola"
kind: fix
status: review
type: proposal
track: desktop
date: 2026-11-21
last-transition-id: 059e63fe-aaa0-467d-b119-961d5bef043e
last-correlation-id: 059e63fe-aaa0-467d-b119-961d5bef043e
last-transition-from: in-progress
last-transition-at: 2026-11-21T03:44:20.166Z
---

# x00123 — Ofrecer una aplicación de Windows de doble clic sin consola

## goal

Tanit.exe abre la ventana Tauri desde dist y su CLI auxiliar funciona por IPC sin consola.

## why

El ejecutable apisrc-windows-x64.exe es un CLI. Al abrirlo desde el Explorador presenta una consola y no ofrece un punto de entrada gráfico.

## non-goals

- Cambiar la firma, publicar una release o retirar el CLI.

## slices

- global_gate: lint

### S1 — Salida portable de Tauri y ejecución nativa de Windows
- **Status**: review
- **Files**: `packages/desktop/src/sidecar.rs`, `scripts/build/desktop-build.script.ts`, `package.json`, `docs/DESKTOP-INSTALL.md`, `docs/delendai/AGENT-BOOTSTRAP.md`, `packages/app/src/index.html`, `packages/app/src/main.ts`, `packages/desktop/tauri.conf.json`, `angular.json`
- **Gate**: e2e
- acceptance:
  - "El build de escritorio portable coloca Tanit.exe y su auxiliar en dist/desktop/windows. Su arranque abre una ventana de aplicación y el auxiliar no tiene consola."
  - "Windows nativo permite abrir un proyecto real, ver endpoints y exportar un archivo en el WebView con los estilos de Angular activos y el cambio de tema visible."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `ec5806fa2775`

## acceptance

- El build de escritorio portable coloca Tanit.exe y su auxiliar en dist/desktop/windows. Su arranque abre una ventana de aplicación y el auxiliar no tiene consola.
- Windows nativo permite abrir un proyecto real, ver endpoints y exportar un archivo en el WebView con los estilos de Angular activos y el cambio de tema visible.
