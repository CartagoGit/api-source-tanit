---
id: x00114
title: "Compilar y arrancar los binarios de Tanit por plataforma desde package.json"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-19
---

# x00114 — Compilar y arrancar los binarios de Tanit por plataforma desde package.json

## goal

Hacer repetible la prueba del ejecutable y la web Angular en WSL y Windows.

## why

La prueba nativa requiere comandos de compilación y copia manual de Angular que los entrypoints actuales no agrupan.

## non-goals

- Publicar instaladores o modificar los gates de release.

## slices

- global_gate: lint

### S1 — Añadir scripts de build y UI nativa para Linux y Windows
- **Status**: pending
- **Files**: `package.json`, `scripts/build/build-binary.script.ts`, `docs/INSTALL.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Los scripts de package.json compilan por separado la CLI Linux x64 y Windows x64; Windows compila a una ubicación accesible para el anfitrión al ejecutarlo desde WSL."
  - "Cada script de interfaz compila Angular, arranca el binario de su plataforma y sirve la app sin copiar archivos a mano."
  - "Una compilación conserva otros archivos de la carpeta de salida y se mantiene el entrypoint de CI para todos los destinos."

## acceptance

- Los scripts de package.json compilan por separado la CLI Linux x64 y Windows x64; Windows compila a una ubicación accesible para el anfitrión al ejecutarlo desde WSL.
- Cada script de interfaz compila Angular, arranca el binario de su plataforma y sirve la app sin copiar archivos a mano.
- Una compilación conserva otros archivos de la carpeta de salida y se mantiene el entrypoint de CI para todos los destinos.
