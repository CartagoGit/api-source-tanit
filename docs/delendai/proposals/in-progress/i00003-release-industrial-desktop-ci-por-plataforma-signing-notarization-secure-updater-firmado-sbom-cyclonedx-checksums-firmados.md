---
id: i00003
title: "Release industrial — desktop CI por plataforma, signing + notarization, secure updater firmado, SBOM CycloneDX, checksums firmados"
kind: infra
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-09-08
dependencies: [a00019#phase-5-multi-language-precision]
last-transition-id: de79e50f-7952-4ca9-a1e1-a2bd2992d197
last-correlation-id: de79e50f-7952-4ca9-a1e1-a2bd2992d197
last-transition-from: review
---

# i00003 — Release industrial — desktop CI por plataforma, signing + notarization, secure updater firmado, SBOM CycloneDX, checksums firmados

## Goal

Consolidar la fase 6 de [a00019](../../in-progress/a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md) como una pipeline de release industrial para Tanit. El resultado exige: desktop CI verde y reproducible en Linux, macOS y Windows; signing endurecido y notarization de macOS; Authenticode con trusted timestamp en Windows; checksums y firmas verificables en Linux; updater firmado con clave pública versionada; un SBOM CycloneDX y provenance attestation adjuntos a cada release; y un `SECURITY.md` con threat model, proceso privado de reporte y política de versiones soportadas.

El signing continúa siendo opt-in para desarrollo mediante `delendai.config.json#release.sign` con default `false`; una release production exige `release.sign=true` y no puede publicar artefactos sin verificar todas las firmas disponibles. Ninguna clave, certificado, password, token de notarization o firma privada se persiste en el repositorio.

## Why

El workflow actual `validate.yml` no contiene un job Rust/Tauri específico. Los cambios en `packages/desktop/` pueden llegar a `develop` sin demostrar que el shell Tauri compila, que el sidecar arranca o que scan/export funcionan. Los releases existentes tampoco ofrecen una cadena verificable: macOS no pasa por codesign + notarytool + staple, Windows no tiene Authenticode ni trusted timestamp, Linux no publica checksums firmados, y falta un updater que rechace artefactos sin confianza. Sin SBOM, provenance y threat model no es posible operar el producto con equipos de seguridad ni responder con evidencia a un incidente de supply chain.

## Why this design

- **Capas verificables, no un flag único**. CI demuestra que cada plataforma compila y arranca; signing demuestra identidad e integridad; el updater repite la verificación antes de instalar; SBOM y threat model hacen auditables los componentes y supuestos de seguridad.
- **Fallo cerrado en release**. Un job de publicación solo continúa cuando build, firma, verificación, SBOM y attestation están presentes. La ausencia de credenciales de signing falla antes de publicar; no se compensa con un artefacto unsigned.
- **Compatibilidad development-first**. `release.sign=false` mantiene el flujo local actual; `release.sign=true` habilita los proveedores de credenciales definidos por plataforma sin obligar a cada desarrollador a configurar certificados.
- **Un único release contract**. La matriz usa pares explícitos `OS × architecture × bundle`, con SHA-256, versión semver, signer y provenance asociados al mismo tag. El manifest no puede describir instaladores sin identidad.
- **Seguridad documentada y operable**. `SECURITY.md` describe límites de confianza, activos protegidos, mitigaciones, reporte, soporte y recuperación para que un auditor pueda reproducir la cadena de confianza.

## Non-goals

- Migrar Tauri ni sustituir el sidecar `apisrc`: la release valida y empaqueta el shell Tauri existente y el CLI autocontenido.
- Añadir canales alpha/beta/stable, staged rollout, downgrade o distribución corporativa; el primer contrato es stable semver.
- Añadir Windows ARM64 o Linux ARM64; la matriz inicial es Linux x64, Windows x64, macOS x64 y macOS arm64. Nuevos targets entran por extensión del mismo manifest.
- Publicar Flatpak, Snap, App Store ni Microsoft Store; esta propuesta cubre instaladores nativos y sus pruebas de trust.
- Implementar disclosure management ni un programa de recompensas; `SECURITY.md` define el canal y el equipo conserva el triaging.

## Architecture

La propuesta se divide en cuatro controles independientes pero encadenados por sus artefactos:

1. **Desktop CI por plataforma (S1)**. `.github/workflows/desktop-ci.yml` construye la misma revisión en hosted runners nativos, corre quality gates Rust y Bun, empaqueta sin publicar y ejecuta un smoke real: sidecar handshake → scan → export → exit code 0. `ci-summary` exige el check `desktop-ci` y la branch protection lo incorpora a `develop`.
2. **Signing y verificación (S2)**. Un contrato de configuración selecciona credenciales por `os`/`arch` y construye un manifest efímero de artefactos. macOS usa hardened runtime + timestamp + notarization + staple; Windows usa Authenticode SHA-256 + trusted timestamp; Linux genera `SHA256SUMS` y detached signatures GPG. Un job `verify-signatures` pasa antes de que `gh release` publique.
3. **Updater firmado (S3)**. El updater Tauri consume un manifest versionado desde un endpoint HTTPS, verifica firma y hash del instalador antes de descargarlo o instalarlo y aborta con un error visible si la prueba criptográfica falla. El instalador actualizado contiene el sidecar de la misma versión.
4. **Supply-chain transparency (S4)**. Tras verificar los artefactos finales, se genera un CycloneDX JSON 1.6 desde el grafo real, se valida su schema, se attesta la provenance de los assets y se publican SBOM, attestation y checksums firmados junto a la release. `SECURITY.md` documenta la cadena de confianza, supported versions, disclosure y límites de cada control.

### Dependency on `a00019#phase-5-multi-language-precision`

La dependencia del frontmatter es deliberada: la release se apoya en la precisión multi-lenguaje y en el snapshot/Application API que preceden a la fase 6. La comprobación no vuelve a implementar `ModuleResolver` ni la detección de frameworks; verifica que el artefacto Desktop contiene el contrato vigente y que el smoke usa un fixture representativo. Mientras `a00019#phase-5-multi-language-precision` no esté cerrada, esta propuesta queda `ready` pero no se puede declarar `done`.

### Artifact contract

Cada instalador publicado se describe por versión semver, nombre, plataforma, arquitectura, formato, SHA-256, firma, signer/key id, referencia de SBOM y referencia de provenance. El manifest se genera en un workspace limpio a partir de los archivos finales; no se aceptan rutas, nombres o hashes hardcodeados. La verificación final vuelve a calcular los hashes desde el staging de release y falla si encuentra drift.

## Slices

- global_gate: e2e

### S1-desktop-ci-platforms — S1 — Desktop CI por plataforma: quality gates y smoke real en Linux/macOS/Windows

- **Status**: done
- **Files**: `.github/workflows/desktop-ci.yml`, `packages/desktop/rust-toolchain.toml`, `scripts/gates/desktop-quality.script.ts`, `scripts/gates/desktop-smoke.script.ts`, `scripts/gates/ci-summary.script.ts`, `tests/desktop/launch-and-scan.test.ts`, `tests/desktop/export-and-exit.test.ts`, `tests/desktop/fixtures/scan-fixture/package.json`, `tests/desktop/fixtures/scan-fixture/src/main.ts`, `docs/CI.md`, `delendai.config.json`
- **DependsOn**: []
- **Gate**: e2e
- acceptanceCriteria:
  - El workflow `desktop-ci` usa hosted runners nativos `ubuntu-latest`, `macos-latest` y `windows-latest`, fija Bun 1.4.2+, Node 20+ y el MSRV Rust 1.80+ en `rust-toolchain.toml`, y mantiene `fail-fast: false` para que un fallo no oculte los targets restantes.
  - En cada OS se ejecutan, como mínimo, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features`, el quality gate Bun, un build Tauri sin publicar y el smoke del sidecar.
  - El smoke compila el sidecar para el target nativo, arranca Tanit, espera un handshake/URL real, abre un fixture de scan representativo, ejecuta scan, ejecuta export Postman, valida el JSON de salida y termina con exit code 0.
  - `desktop-ci` aparece en `ci-summary` y en los required checks de `develop`; un cambio en `packages/desktop/` no puede mergearse con ese check fallido o skipped.
  - `desktop-quality.script.ts` es invocable localmente y en CI, devuelve diagnósticos accionables y no modifica el fixture; el workflow parsea con `actionlint` o equivalente antes de la ejecución.
  - `docs/CI.md` documenta triggers, matriz, secrets mínimos, troubleshooting y el procedimiento para añadir un nuevo `os × arch × bundle`.
  - DoD: un commit/tag de prueba obtiene los tres jobs nativos verdes, el gate local pasa en Linux y el fixture demuestra el flujo completo sin depender de red externa.
- review-state: done
- review-implementer: finch
- review-reviewer: tanit-verifier
- review-log: approved by tanit-verifier — Diseño S1 revisado: workflow desktop-ci con runners nativos Linux/macOS/Windows, smoke test completo, quality gates Rust+Bun, fail-fast:false, CI-summary gate — contrato coherente y sin ambigüedades. Implementador: finch. Reviewer: tanit-verifier (distinto de finch). Gate lint:proposals verde tras reconcile en c18d359."
### S2-signing-notarization — S2 — Signing, notarization y verificación reproducible por plataforma
- **Status**: pending
- **Files**: `.github/workflows/release-desktop.yml`, `scripts/release/prepare-artifacts.mjs`, `scripts/release/sign-macos.sh`, `scripts/release/notarize-macos.sh`, `scripts/release/sign-windows.ps1`, `scripts/release/sign-linux.sh`, `scripts/release/verify-signature.sh`, `packages/contracts/interfaces/release/signing.interface.ts`, `packages/contracts/constants/release/signing.constant.ts`, `packages/desktop/tauri.conf.json`, `docs/RELEASE.md`, `tests/release/signing.spec.ts`
- **DependsOn**: [S1-desktop-ci-platforms]
- **Gate**: e2e
- acceptanceCriteria:
  - "`delendai.config.json#release.sign` tiene default `false`; `release.sign=true` habilita signing y hace que la pipeline production assertion falle si falta cualquier credencial o target requerido."
  - "macOS genera `.app` y `.dmg` por x64/arm64, aplica `codesign` hardened runtime, entitlements mínimos, secure timestamp y Developer ID; `notarytool` espera la aceptación, se staplan ambos artefactos y el runner ejecuta una comprobación de Gatekeeper antes de publicar."
  - "Windows firma `.msi` y NSIS `.exe` x64 con Authenticode SHA-256, certificado EV/Azure Trusted Signing y trusted timestamp RFC 3161; el verifier confirma signer, digest y timestamp desde el artefacto real."
  - "Linux produce `.deb`/`.AppImage` x64, un `SHA256SUMS` generado con `sha256sum` y firmas detached GPG por artefacto/checksum; la verificación usa el keyring publicado y no depende de firmas no verificadas."
  - "El manifest efímero incluye semver, `os`, `arch`, bundle, ruta relativa, SHA-256, firma, signer/key id y referencias de SBOM/provenance; `verify-signature.sh` vuelve a calcular todo desde el manifest y los assets."
  - "El release job adjunta solo artefactos verificados: `.app`/`.dmg` notarizados macOS, `.msi`/`.exe` Authenticode Windows y `.deb`/`.AppImage` con `SHA256SUMS` y `.sig` Linux. La publicación de cualquier target no firmado falla cerrada."
  - "`docs/RELEASE.md` enumera secrets por proveedor, responsabilidades de rotación, troubleshooting, comandos de verificación y la política explícita de que una release es reproducible en identidad, no bit a bit."
  - "DoD: un dry-run sin publicar produce todos los artefactos esperados, cada verificador pasa para su OS y la matriz de credenciales faltantes se prueba sin exponer valores."

### S3-secure-updater — S3 — Updater firmado con manifest versionado y verificación antes de instalar

- **Status**: pending
- **Files**: `packages/desktop/Cargo.toml`, `packages/desktop/src/main.rs`, `packages/desktop/src/updater.rs`, `packages/desktop/capabilities/updater.json`, `packages/desktop/keys/tanit-updater-public-key-v1.pem`, `scripts/release/build-update-manifest.mjs`, `scripts/release/verify-update.sh`, `tests/desktop/updater-contract.rs`, `docs/UPDATER.md`
- **DependsOn**: [S2-signing-notarization]
- **Gate**: e2e
- acceptanceCriteria:
  - Tauri updater queda inicializado desde un contrato explícito de endpoint, public key versionada, versión actual, timeout y política de reintento; la clave privada nunca entra en la app, el repositorio ni los build logs.
  - El manifest HTTPS incluye versión semver, target `os/arch/bundle`, URL, SHA-256, firma, public-key id, versión mínima soportada y provenance; el cliente verifica firma, hash, versión y plataforma antes de descargar o instalar.
  - Una firma inválida, hash alterado, target incompatible, manifest ausente o respuesta no válida aborta con un mensaje visible y un evento de seguridad; no existe fallback a unsigned ni descarga HTTP.
  - El instalador candidato incluye un sidecar `apisrc` compatible y la misma versión semver; un smoke posterior al update comprueba handshake, scan y export antes de cerrar la operación.
  - Se prueba al menos actualización válida, versión anterior, target incorrecto, firma corrupta, hash corrupto, endpoint no disponible y rollback; las pruebas no requieren una cuenta real ni una red externa.
  - `docs/UPDATER.md` explica la rotación de claves, la compatibilidad de manifests, la verificación independiente y el procedimiento de rollback para usuarios y auditores.
  - DoD: el manifest staging se firma y verifica con fixtures locales, la versión anterior se rechaza de forma determinista y el instalador actualizado supera el smoke Desktop.

### S4-sbom-security — S4 — SBOM CycloneDX, provenance attestation y threat model en cada release

- **Status**: pending
- **Files**: `.github/workflows/release-desktop.yml`, `scripts/release/build-sbom.mjs`, `scripts/release/verify-sbom.mjs`, `tests/release/sbom.spec.ts`, `docs/SBOM.md`, `SECURITY.md`
- **DependsOn**: [S2-signing-notarization, S3-secure-updater]
- **Gate**: e2e
- acceptanceCriteria:
  - Cada release genera, a partir de los artefactos finales verificados por S2/S3, un SBOM CycloneDX JSON 1.6 válido con `bomFormat`, `specVersion`, `serialNumber`, version, components, dependencias, hashes y supplier cuando esté disponible.
  - El SBOM cubre Tanit Desktop, el sidecar `apisrc` y el grafo de dependencias Rust/Bun/nativas realmente empaquetado; excluye secretos, certificados privados, credenciales y archivos temporales. El manifest de S3 y el SBOM se validan mutuamente por versión y hash.
  - El workflow ejecuta `actions/attest-build-provenance` o equivalente SLSA-compatible sobre los assets firmados y publica la attestation/provenance junto a la release; una attestation ausente o no verificable impide publicar.
  - `verify-sbom.mjs` valida schema, componentes requeridos, hashes, firma, signer/key id y provenance; sus fixtures cubren SBOM válido, dependencia faltante, hash alterado y provenance no relacionada.
  - `SECURITY.md` incluye threat model con activos, adversaries, trust boundaries, controles por capa (CI, release credentials, signing, updater, endpoint, sidecar y usuario), riesgos aceptados, proceso privado de reporte, GPG/contacto de seguridad, supported versions y ventana de respuesta high/critical.
  - `docs/SBOM.md` explica consumidores, CycloneDX 1.6, consultas comunes, correlación con manifest/checksums, retención y pasos de revalidación para auditores.
  - DoD: un dry-run staging adjunta SBOM, provenance y attestation verificables, y la release real no se puede crear sin esos assets; `bun run lint:proposals:gen-index` y `bun run typecheck` permanecen verdes.

## acceptance

- `desktop-ci` está verde en hosted runners Linux, macOS y Windows y sus smoke tests ejecutan scan/export reales.
- `desktop-ci` forma parte de los required checks y bloquea cambios Desktop no validados.
- macOS publica `.app`/`.dmg` firmados, notarizados y stapled; Windows publica `.msi`/`.exe` Authenticode con timestamp; Linux publica `.deb`/`.AppImage`, `SHA256SUMS` y firmas verificables.
- `release.sign=false` mantiene releases development unsigned y `release.sign=true` convierte la publicación en un flujo fail-closed con credenciales solo en GitHub Secrets.
- El updater verifica firma, hash, target y versión antes de instalar; no instala un artefacto sin confianza y el sidecar permanece compatible.
- Cada release incluye SBOM CycloneDX 1.6, provenance attestation y documentación de auditoría.
- `SECURITY.md` documenta threat model, disclosure privado, supported versions y proceso de respuesta.
- `bun run lint:proposals:gen-index` y `bun run typecheck` están verdes; la proposal permanece en estado de revisión hasta que un verificador independiente apruebe el diseño.

## Risks

- **Credenciales externas ausentes**. El pipeline puede construir artefactos unsigned, pero un job production con `release.sign=true` debe fallar antes de publicar si Apple, Windows o GPG no están configurados. Es un resultado correcto, no un motivo para relajar la trust chain.
- **Rotación de claves**. La pérdida o exposición de una signing key requiere revocación, nueva public key versionada, re-firma de los manifests y una ventana de soporte documentada; no se puede sobrescribir silenciosamente la clave activa.
- **Drift entre artefactos**. El manifest, hashes, SBOM, provenance y assets deben derivarse del mismo staging directory. Cualquier cambio posterior a la verificación obliga a regenerar toda la cadena y repetir la attestation.
- **Entornos hosted**. macOS y Windows solo se construyen en sus runners nativos; la validación local Linux no pretende cross-compilar instaladores firmados. La matriz y el dry-run deben documentar esta limitación.
- **Disponibilidad del updater**. Un endpoint caído no puede forzar una descarga sin firma. El cliente conserva la versión instalada, muestra el fallo y permite reintentar o descargar la release verificada manualmente.
- **Cobertura SBOM incompleta**. Si una dependencia bundled no aparece, el verificador falla la release; el riesgo de publicar un SBOM incompleto es mayor que el coste de regenerarlo.
- **Cambios de APIs de terceros**. `notarytool`, Authenticode, `actions/attest` y Tauri updater pueden cambiar; se fijan versiones/pines y se prueba el flujo en una release de staging antes de actualizar la toolchain.

## Definition of done

- Todos los criterios de S1–S4 están implementados, probados y aprobados por un verificador distinto de quien implementó esta consolidación.
- La release industrial pasa los gates de S1–S4 y el slice queda en `in_review` hasta la peer review; no se cierra desde esta tarea.
- La propuesta enlaza correctamente con `a00019#phase-5-multi-language-precision` y su frontmatter declara `kind: infra` y la dependencia de fase 5.
- Solo se edita este documento de diseño en esta slice; la implementación de CI, scripts, workflows, manifests, claves, SBOM, attestation y documentación corresponde a los slices de ejecución posteriores.
