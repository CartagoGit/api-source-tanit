---
id: p00022
title: "p00022 — `bin/` para lanzar el proyecto desde cualquier lenguaje"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00010 # el binario compilado es el motor que estos wrappers invocan
    - p00021 # sustituye a las reimplementaciones que se retiran
---

# p00022 — `bin/` para lanzar el proyecto desde cualquier lenguaje

## Goal

Que un equipo de PHP, Python, Go, Rust o Java pueda invocar el generador
**desde sus propias herramientas** sin instalar Bun y sin salirse de su
ecosistema.

## why

El público del paquete son APIs de doce lenguajes, pero la única forma de
lanzarlo hoy es `bun`/`bunx` o el binario a pelo. Un equipo de Django no
tiene un `package.json` donde poner el script; un equipo de Go no quiere
un `node_modules` en su repo.

La versión anterior de esto era `runtime/`: **reimplementar el generador
en cada lenguaje**. Eso divergió y se retira en p00021. El enfoque
correcto es el contrario: **un solo motor** (el binario de p00010) y
wrappers finos que lo descarguen y lo invoquen.

## non-goals

- Reimplementar nada. Los wrappers no tienen lógica de dominio: resuelven
  el binario, lo descargan si falta, y le pasan los argumentos.
- Publicar en PyPI, Packagist, crates.io o Maven. Eso es una propuesta
  aparte, cuando la de npm (p00008) esté resuelta.
- Un servidor HTTP. Fuera de alcance.

## slices

### S1 — `bin/postman-from-routes` (shell POSIX)
- **Files**: `bin/postman-from-routes` (nuevo).
- **Gate**: se ejecuta en linux y macOS sin bun instalado.

- Resuelve, en orden: un binario ya descargado en `~/.postman-from-routes/`,
  `bunx`, `npx`. Si no hay ninguno, descarga el binario de la release
  correspondiente a la plataforma y lo cachea.
- **Acceptance**: `./bin/postman-from-routes --help` funciona con un PATH
  sin bun ni node.

### S2 — `bin/postman-from-routes.ps1` (Windows)
- **Files**: `bin/postman-from-routes.ps1` (nuevo).
- **Gate**: revisión manual en Windows.

### S3 — envoltorios por ecosistema
- **Files**: `bin/wrappers/` con un ejemplo mínimo por lenguaje.
- **Gate**: cada uno documentado en `docs/INSTALL.md` con su comando.

- Python: un `postman_from_routes.py` de ~30 líneas que hace `subprocess`
  contra el binario, para poder ponerlo en un `Makefile` o en taskipy.
- PHP: script para `composer.json > scripts`.
- Go: un `//go:generate` de ejemplo.
- Java/Gradle y .NET: la línea equivalente en su fichero de build.
- **Acceptance**: cada envoltorio son <40 líneas y **cero** lógica de
  dominio; si alguno empieza a parsear rutas, está mal.

### S4 — el binario sabe autoactualizarse
- **Files**: `projects/cli/` (comando `upgrade`).
- **Gate**: `bun test`.

- `postman-from-routes upgrade` comprueba la última release y sustituye
  el binario cacheado.
- **Acceptance**: funciona sin permisos de root (cachea en `$HOME`).

## acceptance

- Un proyecto de cada uno de los 12 frameworks puede lanzar el generador
  con una sola línea en su fichero de build habitual.
- Ningún wrapper contiene lógica de escaneo.
- Documentado en `docs/INSTALL.md` con un bloque por ecosistema.
