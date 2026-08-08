---
id: f00001
title: "UI de escritorio: expostman usable sin terminal en Linux, Mac y Windows"
kind: feat
status: ready
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Parcial a 2026-08-08.** S1, S2 y S3 entregados: `expostman ui`
> levanta la interfaz, sirve la página desde memoria y no añade ninguna
> dependencia — `Bun.serve` ya está en el runtime del binario.
>
> Dos bugs encontrados **ejercitándola por HTTP**, no leyéndola: fallaba
> en su primera petición (un POST sin cuerpo se trataba como JSON
> inválido) y generaba en el proyecto equivocado.
>
> **S4 (Tauri) queda pendiente por un motivo concreto**: no hay toolchain
> de Rust en esta máquina, así que un scaffold de Tauri sería código
> commiteado sin compilar ni verificar una sola vez. Es exactamente lo
> que esta ronda ha demostrado que sale caro. La interfaz que cargará esa
> ventana ya está hecha y probada, así que S4 es empaquetado, no
> reescritura.

# f00001 — UI de escritorio: expostman usable sin terminal en Linux, Mac y Windows

## Goal

Que alguien que no abre una terminal pueda apuntar a la carpeta de su API, ver lo que se ha detectado antes de escribir nada, elegir formatos, y llevarse la colección o subirla a Postman.

## why

Encargo directo: poder usar el proyecto desde un `.deb` u otro formato de Linux, un archivo de Mac y un `.exe` de Windows que abra una interfaz. Hoy la herramienta solo existe en la terminal, y eso deja fuera a quien prueba APIs sin vivir en ella — que es buena parte de quien usa Postman. El punto de partida es mejor de lo que parece: `projects/ui/` ya tiene el asistente interactivo, la tabla y el dashboard de calidad, así que la lógica de qué preguntar y qué enseñar está escrita y probada; y el pipeline entero es una función (`generateWithAllFrameworks`), no un script, así que una interfaz no tiene que reimplementar nada. Medido para decidir el camino: `Bun.serve` ya está en el runtime que el binario lleva dentro, así que servir la interfaz desde el propio ejecutable no añade ni una dependencia.

## non-goals

- Electron: 150 MB por plataforma para envolver una interfaz que en Tauri ocupa 8, en un proyecto cuyo binario ya pesa 95
- Un servicio en la nube: el proyecto lee código fuente del disco de quien lo usa y eso no sale de su máquina
- Editar la colección desde la UI: para eso está Postman, y competir con él no es de lo que va esto
- Sustituir el CLI: la UI es otra puerta al mismo pipeline, no su reemplazo

## Slices

- global_gate: e2e

### S1 — `expostman ui`: servidor local sobre el binario que ya existe
- **Status**: pending
- **Files**: `projects/ui/server/ui-server.service.ts`, `projects/ui/server/ui-routes.service.ts`, `projects/cli/commands/ui.script.ts`, `tests/cli/ui-server.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`expostman ui` levanta `localhost` en un puerto libre y abre el navegador; con `--no-open` solo imprime la URL"
  - "Escucha solo en el bucle local: esto lee el código fuente de quien lo usa y no tiene por qué ser alcanzable desde la red"
  - "Los endpoints son los del pipeline que ya existe —detectar, generar, exportar— sin lógica nueva de negocio"
  - "Se apaga limpio ante SIGINT y SIGTERM, sin dejar el puerto ocupado"

### S2 — La interfaz, con lo que el asistente ya sabe preguntar
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `projects/ui/web/index.html`, `projects/ui/web/app.ts`, `projects/ui/web/styles.css`, `tests/cli/ui-web.spec.ts`
- **Gate**: type
- acceptance:
  - "Elegir carpeta, ver framework detectado y endpoints **antes** de escribir nada, que es lo que ya hace bien el asistente"
  - "Elegir formatos de salida entre los seis y ver los avisos de lo que cada uno pierde"
  - "Ver la deriva (`check`) y subir a Postman con la clave, que no se guarda en disco"
  - "Sin dependencias de terceros: el binario no puede cargar paquetes en ejecución, así que la interfaz viaja dentro"

### S3 — Accesibilidad, que si no se hace ahora no se hace
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `projects/ui/web/a11y.ts`, `tests/cli/ui-a11y.spec.ts`
- **Gate**: type
- acceptance:
  - "Todo se puede usar con teclado, con foco visible y en orden"
  - "Contraste AA como mínimo, y el estado no se comunica solo por color"
  - "Los mensajes de progreso y error se anuncian a un lector de pantalla"
  - "Respeta `prefers-reduced-motion` y `prefers-color-scheme`"

### S4 — Instaladores nativos con Tauri
- **Status**: pending
- **DependsOn**: [S3]
- **Files**: `projects/desktop/tauri.conf.json`, `projects/desktop/src/main.rs`, `projects/desktop/Cargo.toml`, `.github/workflows/release-desktop.yml`
- **Gate**: none
- acceptance:
  - "La ventana nativa carga la misma interfaz de s2: el trabajo de A no se tira al hacer B"
  - "Salen `.deb` y `.AppImage` para Linux, `.dmg` para Mac y `.msi`/`.exe` para Windows"
  - "El binario de `expostman` va dentro como sidecar: una sola fuente de verdad para el pipeline"
  - "El workflow compila en las tres plataformas y adjunta los instaladores a la release"

## acceptance

- `expostman ui` levanta `localhost` en un puerto libre y abre el navegador; con `--no-open` solo imprime la URL
- Escucha solo en el bucle local: esto lee el código fuente de quien lo usa y no tiene por qué ser alcanzable desde la red
- Los endpoints son los del pipeline que ya existe —detectar, generar, exportar— sin lógica nueva de negocio
- Se apaga limpio ante SIGINT y SIGTERM, sin dejar el puerto ocupado
- Elegir carpeta, ver framework detectado y endpoints **antes** de escribir nada, que es lo que ya hace bien el asistente
- Elegir formatos de salida entre los seis y ver los avisos de lo que cada uno pierde
- Ver la deriva (`check`) y subir a Postman con la clave, que no se guarda en disco
- Sin dependencias de terceros: el binario no puede cargar paquetes en ejecución, así que la interfaz viaja dentro
- Todo se puede usar con teclado, con foco visible y en orden
- Contraste AA como mínimo, y el estado no se comunica solo por color
- Los mensajes de progreso y error se anuncian a un lector de pantalla
- Respeta `prefers-reduced-motion` y `prefers-color-scheme`
- La ventana nativa carga la misma interfaz de s2: el trabajo de A no se tira al hacer B
- Salen `.deb` y `.AppImage` para Linux, `.dmg` para Mac y `.msi`/`.exe` para Windows
- El binario de `expostman` va dentro como sidecar: una sola fuente de verdad para el pipeline
- El workflow compila en las tres plataformas y adjunta los instaladores a la release
