---
id: s00001
title: "Resolver bloqueo GLib transitivo antes de certificar escritorio Linux"
kind: spike
status: blocked
blockedReason: "GLib 0.18.5 remains affected by RUSTSEC-2024-0429. A compatible Tauri/GTK migration is pending; upstream Tauri #14684 and Wry #1530 remain open as verified 2026-11-10. Linux desktop certification requires a supported fix, dependency audit and installer acceptance."
type: proposal
track: desktop
date: 2026-11-10
last-transition-id: 725b4ae2-57af-4cf2-af92-7ad25b0c2a4e
last-correlation-id: 725b4ae2-57af-4cf2-af92-7ad25b0c2a4e
last-transition-from: in-progress
last-transition-at: 2026-11-10T08:20:20.841Z
---

# s00001 — Resolver bloqueo GLib transitivo antes de certificar escritorio Linux

## goal

Verificar migración soportada Tauri/GTK antes de distribuir escritorio Linux como beta certificada.

## why

glib0.18.5 transitivo GTK0.18/Tauri afectado por RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g; upgrade aislado no satisface restricciones actuales.

## non-goals

- Certificar un instalador solo porque compila.
- Suprimir el aviso o cambiar la política de auditoría.

## slices

- global_gate: none

### S1 — Migración compatible y certificación
- **Status**: pending
- **Files**: `packages/desktop/Cargo.toml`, `packages/desktop/Cargo.lock`, `docs/BETA.md`
- **Gate**: e2e
- acceptance:
  - "Verificar advisory y árbol de dependencias con fecha; ausencia de llamadas propias no prueba inalcanzabilidad transitiva."
  - "Adoptar solución compatible upstream verificada; no ocultar advisory ni forzar parche incompatible."
  - "Auditoría sin vulnerabilidad, pruebas Rust y smoke real de instalador Linux antes de levantar bloqueo; demás plataformas requieren aceptación propia."

## acceptance

- Verificar advisory y árbol de dependencias con fecha; ausencia de llamadas propias no prueba inalcanzabilidad transitiva.
- Adoptar solución compatible upstream verificada; no ocultar advisory ni forzar parche incompatible.
- Auditoría sin vulnerabilidad, pruebas Rust y smoke real de instalador Linux antes de levantar bloqueo; demás plataformas requieren aceptación propia.


## Dependency verification — 2026-11-10

Both upstream migration PRs remain open with no merge date:
[Tauri #14684](https://github.com/tauri-apps/tauri/pull/14684) and
[Wry #1530](https://github.com/tauri-apps/wry/pull/1530).
The [GLib advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
identifies the affected and patched versions. These are tracking references,
not a claim that merging either PR alone certifies Tanit's installer.
Re-evaluate supported dependency releases before resuming implementation.
The local CLI/web acceptance scope remains available independently.


## Debian backport prototype — 2026-11-18

[Debian rust-glib-0.18 0.18.5-7](https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1143114)
carries `0007-glib-fix-UB-in-VariantStrIter-impl_get.patch`. The Debian patch
archive matched the SHA-256 stated in the distribution's source descriptor.
The stock `glib 0.18.5` crate matched Tanit's original Cargo.lock checksum.

The patch applied cleanly without fuzz in a temporary source tree. Linux Cargo
metadata resolved the patched local crate while preserving every crate version
in the Tanit lock. The production Angular build and
`cargo check --locked --offline --all-targets` for the desktop crate both
passed on Linux using the source from commit `9116cc33b348`. The native check
used the previously verified Linux sidecar as a build input and did not
launch it. Cargo used a local `patch.crates-io.glib.path` override and a
temporary lock whose only dependency source change was GLib.

This demonstrates build compatibility for one Linux environment. The Debian
distribution revision is separate from the registry crate's semver. Before
adoption, the build must use verified patched bytes reproducibly, pass an
audit that recognizes their provenance, and pass Rust tests and installer
acceptance. The Tanit dependency lock, installer certification and advisory
remain unchanged.
