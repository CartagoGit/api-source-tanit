---
id: p00038
title: "p00038 — seguridad: remediación de vulnerabilidades, SAST y escaneo de secretos en pipeline CI"
kind: fix
status: ready
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00037
---

# p00038 — seguridad: remediación de vulnerabilidades, SAST y escaneo de secretos en pipeline CI

## Goal

Reducir a **cero** las vulnerabilidades HIGH y CRITICAL en las dependencias
del proyecto, integrar escaneo estático de seguridad (SAST) y detección de
secretos hardcodeados como parte permanente del pipeline CI.

## why

La auditoría de seguridad del 06/08/2026 (`mcp-vertex_security_security_audit`)
detectó **4 vulnerabilidades HIGH** y **7 MEDIUM**:

| Paquete | Severidad | CVE/GHSA | Problema |
|---|---|---|---|
| `brace-expansion` | HIGH | GHSA-rgw5-rvv9-x895 | DoS por arrays intermedios |
| `fast-uri` | HIGH | GHSA-7p8r-x3mc-p8w7 | Confusión de host (SSRF) |
| `ip-address` | HIGH | GHSA-mwp4-54f8-5fhr | Octetos con ceros (SSRF) |
| `undici` | HIGH | GHSA-4cwx-7wf7-3272 | Divulgación cross-user |
| `hono` | MEDIUM | GHSA-8j4g-w8fx-2239 | ReDoS en CORS middleware |
| `undici` | MEDIUM | 5 CVEs adicionales | CRLF, cookie injection, etc. |

Se añadieron `overrides` en `package.json` pero falta:
1. Verificar que `bun install` realmente resuelve las versiones parchadas.
2. Integrar `bun audit` (o equivalente) como gate de CI.
3. Escanear secretos hardcodeados en el código fuente.
4. Ejecutar SAST básico con reglas de CWE para archivos TypeScript.

## non-goals

- Implementar un WAF o protección de red (el proyecto no es un servicio).

## slices

### S1 — Verificar y fijar overrides de dependencias
- **Files**: `package.json`, `bun.lock`.
- **Gate**: `bun audit` sin HIGH/CRITICAL.
- Ejecutar `bun install` y verificar que las versiones resueltas cumplen
  los rangos de los overrides. Si no, ajustar.

### S2 — Gate de seguridad en CI
- **Files**: `.github/workflows/ci.yml`.
- **Gate**: pipeline verde.
- Añadir paso `bun audit --level high` que falle el pipeline si hay
  vulnerabilidades HIGH+.

### S3 — Escaneo de secretos
- **Files**: `.github/workflows/ci.yml`, `.secretlintrc.json`.
- **Gate**: pipeline verde.
- Integrar `secretlint` o `detect-secrets` como paso de CI para evitar
  que se comitan API keys, tokens o credenciales.

### S4 — SAST con reglas de CWE
- **Files**: `.github/workflows/ci.yml`.
- **Gate**: pipeline verde.
- Integrar `semgrep` o Biome con reglas de seguridad para detectar
  patrones como `eval()`, template string injection, path traversal, etc.

## acceptance

- `bun audit` reporta 0 vulnerabilidades HIGH o CRITICAL.
- El pipeline CI falla automáticamente si se introduce una dependencia
  vulnerable o un secreto hardcodeado.
- `bun run validate` verde.
