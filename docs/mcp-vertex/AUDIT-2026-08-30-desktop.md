---
title: "Auditoría de la zona Rust de escritorio"
track: export-to-postman
date: 2026-08-30
status: draft
---

# Auditoría desktop 2026-08-30

## Alcance y snapshot

Se revisó `packages/desktop/`, el workflow `.github/workflows/release-desktop.yml`
y los scripts `desktop:build` relacionados. La zona contiene un wrapper Tauri
2 que arranca el binario `expostman` como sidecar y carga la interfaz servida
por ese proceso.

La cobertura de esta pasada es estática. El build nativo no se declara verde
sin ejecutar la toolchain Rust/Tauri y las dependencias de sistema de cada
plataforma.

## Inventario

- `Cargo.toml`: binario `expostman-desktop`, dependencias `tauri` y
  `tauri-plugin-shell`, optimización de release y stripping.
- `src/main.rs`: arranque del sidecar, lectura de stdout para descubrir el
  puerto local, creación de la ventana y terminación del hijo al cerrar.
- `build.rs`: delega en `tauri_build::build()`.
- `tauri.conf.json`: ventana externa hacia `127.0.0.1`, CSP restrictiva y
  `externalBin` con `binaries/expostman`.
- `gen/schemas/`: esquemas generados de Tauri; no hay una capability propia
  con permisos adicionales en el árbol auditado.
- `release-desktop.yml`: matriz Linux/macOS/Windows, instalación de Rust,
  dependencias Linux y empaquetado de `deb`, `AppImage`, `dmg`, `msi` y NSIS.

## Trust boundaries

1. La interfaz web local controla indirectamente el sidecar mediante la URL
   localhost que recibe la ventana.
2. El binario Tauri ejecuta `binaries/expostman` con los permisos del usuario.
3. El sidecar puede leer el proyecto elegido y escribir artefactos en su
   carpeta de salida.
4. El workflow de release descarga dependencias y genera instaladores en
   runners de GitHub; esos artefactos pasan a la release publicada.

## Hallazgos

### D-001 [MEDIUM] Sidecar ejecutado desde un recurso empaquetado sin validación adicional

**Evidencia:** `src/main.rs` resuelve `expostman` desde `BaseDirectory::Resource`
y lo ejecuta directamente con `ui --no-open`.

**Impacto:** la integridad del instalador y de sus recursos es el control
principal sobre el código que obtiene ejecución con los permisos del usuario.

**Decisión:** no se corrige en esta auditoría porque requiere definir firma,
actualización y distribución de binarios. Debe abrirse una propuesta hija si
se habilita actualización automática o descarga de sidecars.

### D-002 [LOW] La salida stderr del sidecar se descarta

**Evidencia:** `Command` usa `stderr(Stdio::null())`.

**Impacto:** un fallo de arranque pierde contexto diagnóstico y puede terminar
mostrando sólo el mensaje genérico de timeout.

**Decisión:** mejora recomendada, no bloqueante para el empaquetado. Puede
resolverse capturando una cantidad acotada de stderr y añadiéndola al error.

### D-003 [LOW] El cierre del sidecar no espera confirmación del hijo

**Evidencia:** en `WindowEvent::Destroyed` se llama a `kill()` sin `wait()`.

**Impacto:** puede quedar un proceso zombie en plataformas donde el cierre no
sea recolectado inmediatamente.

**Decisión:** no bloquea el release actual; añadir un test o fix específico si
se observa el proceso residual en CI o en una prueba manual.

## Controles positivos

- La ventana no expone comandos Rust propios ni un API IPC de negocio.
- La CSP limita la conexión a `127.0.0.1` y desactiva fuentes por defecto.
- El sidecar se mata al destruir la ventana.
- `Cargo.lock` está versionado.
- El workflow separa los runners por plataforma y usa `fail-fast: false`.
- El workflow declara `contents: write` sólo para adjuntar artefactos a la
  release.

## Build reproducible

La configuración y el lockfile permiten reproducir el build con:

```text
bun install
bun run desktop:build
```

La reproducción local completa queda pendiente de disponer de Rust, Tauri CLI
y las dependencias nativas del sistema. El workflow documenta las librerías
Linux instaladas; macOS y Windows dependen de sus SDK de runner.

## Resultado y destino

No se detectó un hallazgo CRITICAL o HIGH en la pasada estática. D-001 requiere
una decisión de firma/distribución antes de convertirlo en fix. D-002 y D-003
quedan como mejoras LOW, sin bloquear la publicación actual.