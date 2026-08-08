---
id: i00001
title: "Contenedores con las herramientas: desbloquear Tauri y hacer el gate reproducible"
kind: infra
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Cerrada 2026-08-08.** La imagen construye, el gate pasa dentro
> (1982 tests, 21/21 ejemplos), los cuatro binarios compilan, el de Linux
> genera 9 requests desde una imagen **sin bun ni node**, y el `.deb` sale
> con la ventana y el sidecar dentro. Nada de esto se escribió sin
> ejecutarlo.
>
> **Se pagó solo la primera vez que corrió**: cuatro fallos que en la
> máquina de desarrollo no se podían ver — `bash -lc` tirando el PATH,
> dos tests atados al nombre de la carpeta del checkout, el test de
> permisos pasando siempre como root, y `lint:bootstrap-drift` verde solo
> porque el checkout hermano existe aquí.
>
> **Y le puso número a `p00007`**: lo que esa propuesta describe como
> «cambiar una línea cuando se publique» es el repositorio no siendo
> autocontenido, y solo se nota al construirlo en limpio.
>
> Lo que **no** sale del contenedor: el `.AppImage`. `linuxdeploy` lo
> monta con FUSE y falla incluso con `/dev/fuse`, `SYS_ADMIN` y AppArmor
> abierto. Se probó; darle privilegios para nada era el peor de los dos
> mundos. Lo produce el workflow.
>
> De paso destapó que `lint:proposals` no conocía `infra`, `breaking`,
> `spike` ni `legacy` —kinds que el servidor MCP sí acepta—, así que una
> propuesta creada con la herramienta oficial no tenía dónde archivarse.

# i00001 — Contenedores con las herramientas: desbloquear Tauri y hacer el gate reproducible

## Goal

Que ninguna tarea de este repositorio quede bloqueada por una herramienta ausente en la máquina, y que lo que se entregue se haya ejecutado al menos una vez antes de commitearlo.

## why

`f00001` S4 —los instaladores nativos— quedó bloqueado por un motivo concreto: Tauri necesita Rust y esta máquina no tiene toolchain (`cargo not found`). La única alternativa era commitear un scaffold sin compilarlo una sola vez, y esta ronda ya ha demostrado lo que eso cuesta: tres comandos del CLI —`list`, `init` y `enrich`— estaban rotos precisamente porque nadie los había ejecutado nunca. `list` no listaba nada en los 21 frameworks, `init` empeoraba el proyecto que venía a configurar y `enrich` destruía 8 de 18 requests. Los tres estaban a un `bun run` de distancia de verse. Un contenedor con las herramientas dentro convierte «no puedo verificarlo» en «lo verifico aquí», y de paso paga dos deudas más: el gate deja de depender de lo que cada máquina tenga instalado, y la promesa del README —«no necesitan Bun ni Node en la máquina destino»— pasa a comprobarse en una imagen que efectivamente no los tiene, en vez de creerse.

## non-goals

- Desarrollar dentro del contenedor: el ciclo normal sigue siendo `bun run` en la máquina. Esto es para lo que la máquina no puede hacer.
- Fingir que desde Linux salen los instaladores de Mac y Windows: cada uno exige su propio SDK y su firma, y eso es cosa del workflow en sus corredores.
- Meter Docker en `bun run validate`: el gate tiene que seguir corriendo en segundos sin demonio de por medio.

## Slices

- global_gate: e2e

### S1 — `.docker/` con el taller, y que la imagen construya de verdad
- **Status**: pending
- **Files**: `.docker/Dockerfile`, `.docker/docker-compose.yml`, `.dockerignore`
- **Gate**: none
- acceptance:
  - "`docker build --target toolchain` termina y deja `bun`, `cargo` y `cargo tauri` disponibles"
  - "Las versiones van fijadas: un `latest` hace que el contenedor deje de reproducir el entorno del día que se construyó"
  - "El contexto no arrastra `node_modules` del host: traen binarios compilados para el host y colarlos produce fallos que parecen del código"

### S2 — Atajos y documentación, para que se use sin leerse el compose
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `package.json`, `docs/INSTALL.md`, `CONTRIBUTING.md`
- **Gate**: lint
- acceptance:
  - "`bun run docker:validate`, `docker:binaries`, `docker:installers` y `docker:shell` existen y funcionan"
  - "Queda escrito **cuándo** usarlos: para lo que la máquina no puede hacer, no para el día a día"
  - "`lint:docs` sigue verde"

### S3 — El gate completo dentro del contenedor, sin nada instalado a mano
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `.docker/README.md`
- **Gate**: e2e
- acceptance:
  - "`docker compose run --rm validate` pasa los 2055 tests y los 21 ejemplos"
  - "Si falla algo que en la máquina pasa, se anota: es una dependencia oculta del entorno y merece su propio arreglo"

### S4 — El binario probado en una imagen SIN Bun ni Node
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `.docker/smoke.md`
- **Gate**: none
- acceptance:
  - "La etapa `runtime` no instala ningún runtime de JavaScript"
  - "`docker compose run --rm smoke` ejecuta `expostman --help` desde el binario compilado"
  - "Si el ejecutable no fuera autocontenido, este servicio no arranca — que es justo lo que se quiere que pase aquí y no en la máquina de quien lo descargue"

### S5 — f00001 S4: los instaladores, compilados y verificados dentro
- **Status**: pending
- **DependsOn**: [S1, S2]
- **Files**: `projects/desktop/tauri.conf.json`, `projects/desktop/Cargo.toml`, `projects/desktop/src/main.rs`, `projects/desktop/build.rs`, `.github/workflows/release-desktop.yml`
- **Gate**: none
- acceptance:
  - "La ventana nativa carga la **misma** interfaz que `expostman ui`: el trabajo de f00001 no se reescribe"
  - "El binario de `expostman` viaja dentro como sidecar, para que no haya dos pipelines"
  - "`.deb` y `.AppImage` se producen **dentro del contenedor** y se comprueba que existen y pesan algo"
  - "El workflow compila en las tres plataformas; Mac y Windows solo ahí, y la propuesta dice por qué"

## acceptance

- `docker build --target toolchain` termina y deja `bun`, `cargo` y `cargo tauri` disponibles
- Las versiones van fijadas: un `latest` hace que el contenedor deje de reproducir el entorno del día que se construyó
- El contexto no arrastra `node_modules` del host: traen binarios compilados para el host y colarlos produce fallos que parecen del código
- `bun run docker:validate`, `docker:binaries`, `docker:installers` y `docker:shell` existen y funcionan
- Queda escrito **cuándo** usarlos: para lo que la máquina no puede hacer, no para el día a día
- `lint:docs` sigue verde
- `docker compose run --rm validate` pasa los 2055 tests y los 21 ejemplos
- Si falla algo que en la máquina pasa, se anota: es una dependencia oculta del entorno y merece su propio arreglo
- La etapa `runtime` no instala ningún runtime de JavaScript
- `docker compose run --rm smoke` ejecuta `expostman --help` desde el binario compilado
- Si el ejecutable no fuera autocontenido, este servicio no arranca — que es justo lo que se quiere que pase aquí y no en la máquina de quien lo descargue
- La ventana nativa carga la **misma** interfaz que `expostman ui`: el trabajo de f00001 no se reescribe
- El binario de `expostman` viaja dentro como sidecar, para que no haya dos pipelines
- `.deb` y `.AppImage` se producen **dentro del contenedor** y se comprueba que existen y pesan algo
- El workflow compila en las tres plataformas; Mac y Windows solo ahí, y la propuesta dice por qué
