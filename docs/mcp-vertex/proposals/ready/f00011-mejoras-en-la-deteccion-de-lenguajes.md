---
id: f00011
title: "feat(core): más vias de detección de lenguajes + heurísticas de scoring mejoradas (FEAT-010 + L-U07)"
kind: feat
date: 2026-09-03
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00009
---

# f00011 — feat(core): más vías de detección de lenguajes + heurísticas de scoring

Esta propuesta agrupa FEAT-010 y L-U07 de la auditoría `a00009`: añadir
caminos de detección que los frameworks soportados no miran hoy, y
mejorar el scoring de los que ya existen.

## Goal

Que el detector reconozca un proyecto con más de una señal (no solo el
manifiesto principal), y que proyectos con archivos no estándar
(`wrangler.toml`, `vercel.json`, `serverless.yml`, `Cargo.toml` en
raíz vs en subdir, `package.json` sin `main`) se detecten bien.

## Cambios propuestos

### 1. Señales adicionales por framework

| Framework | Señal extra | Score |
|---|---|---|
| `hono` | `wrangler.toml` en raíz | 0.6 |
| `nextjs` | `next.config.{js,mjs,ts}` | 0.5 (suma si además hay pages/app) |
| `express` | `package.json#scripts.start` contiene `node` | 0.3 |
| `fastify` | `package.json#type === "module"` + `fastify` | 0.2 adicional |
| `nestjs` | `nest-cli.json` | 0.7 |
| `springboot` | `build.gradle` o `pom.xml` con `spring-boot-starter-*` | refinar |
| `symfony` | `symfony.lock` además de `composer.json` | 0.3 adicional |
| `rails` | `config/application.rb` (Ruby) | 0.5 (suma si hay `Gemfile` + `rails`) |
| `gin` / `fiber` | múltiples `*.go` con `func main` + Gin/Fiber imports | 0.4 adicional |
| `openapi` | detectar también `*.yaml` en `public/`, `resources/`, `api/`, `docs/`, `src/` | ya está; falta el test |

### 2. Heurísticas compartidas

- **Multi-manifiesto**: si hay `package.json` y `composer.json`, hoy
  gana uno por suerte; añadir lógica "ambos, deja al usuario elegir".
- **Subdir detection**: hoy los scanners miran raíz; permitir
  `--framework-search-root <subdir>` (CLI) o
  `mcp-vertex.config.json#frameworkSearchRoot` (config).
- **Lockfiles como señal**: `pnpm-lock.yaml` → pnpm (no cambia
  framework pero ayuda a Express/NestJS); `bun.lockb` → Bun runtime
  (afecta a hono, express, fastify).

### 3. Detección de proyecto híbrido

Si dos detectores puntúan >= 0.7, el orquestador devuelve ambos en
`match.frameworks[]` (ya existe el campo) y la UI los muestra.

## Slices

- **S1**: añadir las 10 señales extras (cada una con su test
  focalizado).
- **S2**: lógica de multi-manifiesto con UI que pregunta al usuario.
- **S3**: opción `frameworkSearchRoot` en CLI + config.
- **S4**: lockfile detection (pnpm, bun) como bonus score.

## Definition of done

- [ ] 10 señales nuevas con test focalizado cada una.
- [ ] Multi-manifiesto: el usuario ve los dos frameworks y elige.
- [ ] `--framework-search-root` documentado en INSTALL.md y CLI help.
- [ ] `bun run validate` verde.
- [ ] Commit + push.
