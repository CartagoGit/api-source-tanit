---
id: p00038
title: "p00038 — seguridad: remediación de vulnerabilidades, SAST y escaneo de secretos en pipeline CI"
kind: fix
status: done
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

La auditoría de seguridad del 06/08/2026 (`delendai_security_security_audit`)
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

> **Cerrada el 2026-08-07.** S1 ya estaba (0 vulnerabilidades). S3 y S4
> se hacen **como lints propios**, no con `secretlint` ni `semgrep`, y el
> motivo está abajo.

## por qué los gates son propios y no herramientas de terceros

La propuesta pedía `secretlint`/`detect-secrets` y `semgrep` como pasos
de CI. Se han escrito aquí, con los otros nueve lints, por dos razones:

**Un gate que solo corre en CI llega tarde.** Avisa de la credencial
*después* de que esté en el historial de Git, y sacarla de ahí ya no es
editar un fichero: hay que reescribir el historial y **rotar la clave**.
Estos corren en `bun run lint`, en local, antes del commit.

**Un catálogo genérico sobre este repo es sobre todo ruido.** Semgrep
avisaría de inyección de SQL en un proyecto sin base de datos. Y un lint
ruidoso se acaba desactivando, que es la peor forma de no tener
seguridad. Las cuatro reglas de `lint:sast` salen de lo que **esta**
herramienta hace de verdad: lee código ajeno y lo pasa por regex, lanza
procesos, escribe artefactos que la gente comparte, y maneja una clave de
API de Postman.

## el detalle que hace que no sea ruido

`lint:secrets` tiene dos familias de reglas con criterios distintos:
prefijos de proveedor (`PMAK-`, `AKIA`, `ghp_`…), que son inconfundibles;
y asignaciones a nombres sospechosos, donde sí hay riesgo de falso
positivo. Para las segundas se exige longitud, variedad de caracteres y
que no sea un marcador de posición.

Eso importa mucho aquí: los fixtures son proyectos de API **de mentira**,
llenos de `password` y `token` a propósito. Un `password: "fake"` o un
`token: "{{token}}"` no se marcan.

En `lint:sast`, los literales de cadena inertes se vacían antes de
aplicar los patrones — `eval(` entre comillas es texto, no una llamada.
Sin eso, el propio spec del lint se acusaba a sí mismo y un
`console.error("usa POSTMAN_API_KEY=<key>")` contaba como imprimir la
clave por el hecho de nombrarla.

## slices

### S1 — Verificar y fijar overrides de dependencias
- **Estado**: ya estaba. `bun audit` da **0 vulnerabilidades**. Los
  `overrides` del `package.json` resuelven a versiones parchadas y el
  lockfile está regenerado.
- **Files**: `package.json`, `bun.lock`.
- **Gate**: `bun audit` sin HIGH/CRITICAL.
- Ejecutar `bun install` y verificar que las versiones resueltas cumplen
  los rangos de los overrides. Si no, ajustar.

### S2 — Gate de seguridad en CI
- **Estado**: done (2026-08-07)
- `bun run security:audit` (`bun audit --audit-level=high`) como paso
  propio del workflow, **después** de `validate`: así un aviso de
  seguridad no tapa un fallo de tipos, y se ve en cuál de los dos falló.
  El umbral es HIGH a propósito — un MEDIUM en una dependencia de
  desarrollo no debe bloquear un PR, pero sí verse.
- **Files**: `.github/workflows/ci.yml`.
- **Gate**: pipeline verde.
- Añadir paso `bun audit --level high` que falle el pipeline si hay
  vulnerabilidades HIGH+.

### S3 — Escaneo de secretos
- **Estado**: done (2026-08-07)
- **Ficheros**: `scripts/gates/lint-secrets.script.ts` (nuevo),
  `tests/cli/security-lints.spec.ts` (nuevo).
- 8 formatos de proveedor + heurística de valor sobre 518 ficheros.
- **Files**: `.github/workflows/ci.yml`, `.secretlintrc.json`.
- **Gate**: pipeline verde.
- Integrar `secretlint` o `detect-secrets` como paso de CI para evitar
  que se comitan API keys, tokens o credenciales.

### S4 — SAST con reglas de CWE
- **Estado**: done (2026-08-07)
- **Ficheros**: `scripts/gates/lint-sast.script.ts` (nuevo).
- 4 reglas: `eval`/`new Function`, composición de comandos de shell,
  volcado de `process.env`, y clave de API impresa por consola.
- **Files**: `.github/workflows/ci.yml`.
- **Gate**: pipeline verde.
- Integrar `semgrep` o Biome con reglas de seguridad para detectar
  patrones como `eval()`, template string injection, path traversal, etc.

## aceptación

- `bun audit` reporta 0 vulnerabilidades. ✔
- El pipeline falla si entra una dependencia vulnerable o un secreto. ✔
  Y además falla **en local**, antes del commit, que es donde todavía se
  puede arreglar sin rotar la clave.
- Los 30 tests de `security-lints.spec.ts` comprueban las dos mitades:
  que **cazan** lo que dicen cazar, y que **no marcan** lo que no lo es.
  Un lint de seguridad que no encuentra nada es indistinguible de uno
  roto — los dos dan verde.
- `bun run validate` verde. ✔ 1772 tests, 19/19 ejemplos, **10 lints**.
