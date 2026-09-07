---
id: i00003
title: "Release industrial — desktop CI por plataforma, signing + notarization, secure updater firmado, SBOM CycloneDX, checksums firmados"
kind: infra
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
---

# i00003 — Release industrial — desktop CI por plataforma, signing + notarization, secure updater firmado, SBOM CycloneDX, checksums firmados

## Goal

Llevar la release pipeline de Tanit al nivel de un producto de escritorio distribuido en producción: (1) desktop CI corre `cargo fmt --check` + `cargo clippy -- -D warnings` + `cargo test` + smoke launch/scan/export en ubuntu-latest + macos-latest + windows-latest; (2) signing + notarization macOS (codesign + notarytool), Authenticode Windows, checksums firmados Linux; (3) updater firmado (Tauri updater con public key versionada, auto-update transparente); (4) SBOM CycloneDX generado por release + attestation subida al GitHub release; (5) `SECURITY.md` documenta threat model + proceso de reporte + supported versions; (6) backwards compat: el signing se introduce opt-in via `delendai.config.json#release.sign=true`; sin flag se mantiene el binario sin firma (dev-friendly). El cierre del bloque (f) de [a00019](./a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo confirmó que el workflow actual `validate.yml` no incluye ningún job Rust/Tauri — los cambios en `packages/desktop/src-tauri/` (main.rs, capabilities, Cargo.toml) llegan a `develop` sin que la CI valide que compilan o que el sidecar arranca; los releases existentes no están firmados ni notarizados (Apple Gatekeeper rechazará el .dmg, Windows SmartScreen el .exe, distros Linux exigirán checksums verificables); no hay SBOM (requisito creciente en supply chain security y EU CRA); no hay updater (los usuarios tienen que descargar manualmente cada release). Hasta que esto se cierre, Tanit no puede pasar de "release aficionado" a "release industrial", y muchos consumidores potenciales (empresas, equipos de seguridad) lo rechazan por defecto.

## non-goals

- Migrar de Tauri 1.x a Tauri 2.0 si requiere reescritura significativa — los plugins oficiales se añaden sobre la versión actual; si un plugin requiere Tauri 2.0, se documenta como work item separado.
- Añadir Windows ARM64 o Linux ARM64 al matrix de release — inicialmente x64 + macOS arm64; ARM Linux entra en una propuesta posterior.
- Soporte de canales de release múltiples (alpha/beta/stable) — un solo canal (stable) con tags semver; canales múltiples son work item posterior.
- Generar binarios para todas las distribuciones Linux — al menos .deb + .AppImage; Flatpak/Snap son work items separados.
- Implementar el reporte de vulnerabilidades coordinado — `SECURITY.md` documenta el proceso, pero el trabajo real de triaging es del equipo de seguridad.

## Slices

- global_gate: e2e

### S1-desktop-ci-platforms — S1 — Desktop CI por plataforma: cargo fmt/clippy/test + smoke en macOS/Windows/Linux
- **Status**: pending
- **Files**: `.github/workflows/desktop-ci.yml`, `scripts/gates/desktop-quality.script.ts`, `scripts/gates/desktop-smoke.script.ts`, `packages/desktop/tests/smoke/launch-and-scan.test.ts`, `packages/desktop/tests/smoke/export-and-exit.test.ts`, `packages/desktop/tests/fixtures/scan-fixture/package.json`, `packages/desktop/tests/fixtures/scan-fixture/src/main.ts`, `docs/CI.md`, `delendai.config.json`
- **Gate**: e2e
- acceptance:
  - "Job `desktop-ci` corre en ubuntu-latest + macos-latest + windows-latest con matrix (Rust 1.80+, Node 20+); pasos: checkout, setup-rust, setup-bun, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, build Tauri, smoke launch"
  - "Smoke: lanzar binario compilado, abrir fixture `scan-fixture`, esperar sidecar handshake, ejecutar scan, ejecutar export, exit cleanly; assertion en output JSON y exit code 0"
  - "`scripts/gates/desktop-quality.script.ts` corre como parte de `bun run validate` (gate local) y como paso del job CI"
  - "`docs/CI.md` documenta el flujo: develop → desktop-ci → tests/coverage → required checks; cómo añadir un nuevo platform target"
  - "El job forma parte de los required checks de develop (configurado en `c00010` S2 si ya cerrado, o en este slice si todavía no)"
  - "Regresión cerrada: cambios en `packages/desktop/src-tauri/` sin PR que pase `desktop-ci` no llegan a develop"
  - "DoD slice: workflow dry-run verde con `act` (o equivalente); `cargo check` verde en local en Linux"

### S2-signing-notarization — S2 — Signing + notarization macOS/Windows/Linux + checksums firmados
- **Status**: pending
- **DependsOn**: [S1-desktop-ci-platforms]
- **Files**: `scripts/release/sign-macos.sh`, `scripts/release/notarize-macos.sh`, `scripts/release/sign-windows.ps1`, `scripts/release/sign-linux.sh`, `scripts/release/verify-signature.sh`, `.github/workflows/release.yml`, `packages/desktop/src-tauri/tauri.conf.json`, `docs/RELEASE.md`
- **Gate**: e2e
- acceptance:
  - "macOS: `sign-macos.sh` invoca `codesign --deep --strict --options=runtime --timestamp` con Developer ID Application + `--entitlements`; `notarize-macos.sh` usa `xcrun notarytool submit --wait --keychain-profile` con Apple ID + app-specific password desde GitHub Secrets; resultado: `xcrun stapler staple` aplicado al .dmg y .app"
  - "Windows: `sign-windows.ps1` usa `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f cert.pfx /p <password>` con Azure Trusted Signing o certificado EV; `.msi` y `.exe` firmados"
  - "Linux: `sign-linux.sh` genera `.sig` files con GPG (`gpg --detach-sign --armor`); SHA256SUMS con `sha256sum -b`; verificación reproducible"
  - "`packages/desktop/src-tauri/tauri.conf.json` actualizado con `bundle.macOS.signingIdentity`, `bundle.windows.certificateThumbprint`, etc. — todo opcional, default `null` (dev-friendly)"
  - "Release workflow produce artefactos firmados: `.dmg` + `.app` notarizado, `.msi`/`.exe` Authenticode, `.deb`/`.AppImage` + `.sig` + `SHA256SUMS`"
  - "`scripts/release/verify-signature.sh` valida cada artefacto contra su firma correspondiente; usado en CI para verificar el output antes de publicar"
  - "`docs/RELEASE.md` documenta el flujo de signing, las claves requeridas via GitHub Secrets, y el comando de verificación"
  - "DoD slice: release dry-run (sin publicar) genera todos los artefactos firmados; CI workflow dry-run verde"

### S3-secure-updater-sbom — S3 — Secure updater firmado + SBOM CycloneDX + provenance attestation
- **Status**: pending
- **DependsOn**: [S2-signing-notarization]
- **Files**: `packages/desktop/src-tauri/src/updater.rs`, `packages/desktop/src-tauri/capabilities/updater.json`, `scripts/release/build-sbom.sh`, `scripts/release/verify-update.sh`, `docs/SBOM.md`, `docs/UPDATER.md`, `SECURITY.md`
- **Gate**: e2e
- acceptance:
  - "Tauri updater activo (`packages/desktop/src-tauri/src/updater.rs`); public key versionada; el manifest firmado se publica en `https://<owner>.github.io/<repo>/release.json` (o equivalente)"
  - "Auto-update transparente: el binario verifica la firma antes de instalar; si la firma falla, aborta con mensaje claro (no silent fallback a unsigned)"
  - "`scripts/release/build-sbom.sh` genera CycloneDX SBOM por release (TypeScript via `cdxgen`, Rust via `cargo-cyclonedx`); subido al GitHub release como asset `tanit-<version>-sbom.cdx.json`"
  - "Provenance attestation via `actions/attest` o `in-toto` para cada binario; subido al GitHub release como `attestation.jsonl`"
  - "`scripts/release/verify-update.sh`: dado un binario y un manifest URL, verifica firma + hash + provenance; documentado en `docs/UPDATER.md` como comando para auditores externos"
  - "`docs/SBOM.md` explica cómo consumir el SBOM (formatos, tools, queries comunes)"
  - "`SECURITY.md` documenta: threat model (qué protege cada capa), supported versions (N-1 minor), proceso de reporte (`security@tanit.dev` con GPG key), ventana de respuesta (90 días para high/critical)"
  - "DoD slice: SBOM generado para release actual + attestation válida; updater manifest firmado y verificable en staging"

## acceptance

- Job `desktop-ci` corre en ubuntu-latest + macos-latest + windows-latest con matrix (Rust 1.80+, Node 20+); pasos: checkout, setup-rust, setup-bun, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, build Tauri, smoke launch
- Smoke: lanzar binario compilado, abrir fixture `scan-fixture`, esperar sidecar handshake, ejecutar scan, ejecutar export, exit cleanly; assertion en output JSON y exit code 0
- `scripts/gates/desktop-quality.script.ts` corre como parte de `bun run validate` (gate local) y como paso del job CI
- `docs/CI.md` documenta el flujo: develop → desktop-ci → tests/coverage → required checks; cómo añadir un nuevo platform target
- El job forma parte de los required checks de develop (configurado en `c00010` S2 si ya cerrado, o en este slice si todavía no)
- Regresión cerrada: cambios en `packages/desktop/src-tauri/` sin PR que pase `desktop-ci` no llegan a develop
- DoD slice: workflow dry-run verde con `act` (o equivalente); `cargo check` verde en local en Linux
- macOS: `sign-macos.sh` invoca `codesign --deep --strict --options=runtime --timestamp` con Developer ID Application + `--entitlements`; `notarize-macos.sh` usa `xcrun notarytool submit --wait --keychain-profile` con Apple ID + app-specific password desde GitHub Secrets; resultado: `xcrun stapler staple` aplicado al .dmg y .app
- Windows: `sign-windows.ps1` usa `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f cert.pfx /p <password>` con Azure Trusted Signing o certificado EV; `.msi` y `.exe` firmados
- Linux: `sign-linux.sh` genera `.sig` files con GPG (`gpg --detach-sign --armor`); SHA256SUMS con `sha256sum -b`; verificación reproducible
- `packages/desktop/src-tauri/tauri.conf.json` actualizado con `bundle.macOS.signingIdentity`, `bundle.windows.certificateThumbprint`, etc. — todo opcional, default `null` (dev-friendly)
- Release workflow produce artefactos firmados: `.dmg` + `.app` notarizado, `.msi`/`.exe` Authenticode, `.deb`/`.AppImage` + `.sig` + `SHA256SUMS`
- `scripts/release/verify-signature.sh` valida cada artefacto contra su firma correspondiente; usado en CI para verificar el output antes de publicar
- `docs/RELEASE.md` documenta el flujo de signing, las claves requeridas via GitHub Secrets, y el comando de verificación
- DoD slice: release dry-run (sin publicar) genera todos los artefactos firmados; CI workflow dry-run verde
- Tauri updater activo (`packages/desktop/src-tauri/src/updater.rs`); public key versionada; el manifest firmado se publica en `https://<owner>.github.io/<repo>/release.json` (o equivalente)
- Auto-update transparente: el binario verifica la firma antes de instalar; si la firma falla, aborta con mensaje claro (no silent fallback a unsigned)
- `scripts/release/build-sbom.sh` genera CycloneDX SBOM por release (TypeScript via `cdxgen`, Rust via `cargo-cyclonedx`); subido al GitHub release como asset `tanit-<version>-sbom.cdx.json`
- Provenance attestation via `actions/attest` o `in-toto` para cada binario; subido al GitHub release como `attestation.jsonl`
- `scripts/release/verify-update.sh`: dado un binario y un manifest URL, verifica firma + hash + provenance; documentado en `docs/UPDATER.md` como comando para auditores externos
- `docs/SBOM.md` explica cómo consumir el SBOM (formatos, tools, queries comunes)
- `SECURITY.md` documenta: threat model (qué protege cada capa), supported versions (N-1 minor), proceso de reporte (`security@tanit.dev` con GPG key), ventana de respuesta (90 días para high/critical)
- DoD slice: SBOM generado para release actual + attestation válida; updater manifest firmado y verificable en staging
