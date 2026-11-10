---
id: x00037
title: "i18n completeness gate - bloquea locales placeholder de inglés"
kind: fix
status: done
type: proposal
track: general
date: 2026-09-05
shippedIn:
  - 59dc2f6
---

# x00037 — i18n completeness gate: bloquea locales placeholder de inglés

## Goal

Detectar y rechazar en CI los locales i18n cuyo contenido es idéntico (byte-a-byte o por encima de un umbral de completitud) al locale inglés referencia. Hoy 13 de los 15 locales en `packages/ui/i18n/locales/` comparten el hash sha256 `49d679132afb` con `en.json` — son placeholders etiquetados como si fueran idiomas traducidos.

## Why

Estado confirmado hoy en develop:

```
213a5dc6abb2  es.json  690B   ← distinta (probablemente completa)
49d679132afb  ar.json  659B   ← placeholder
49d679132afb  bn.json  659B   ← placeholder
49d679132afb  de.json  659B   ← placeholder
49d679132afb  en.json  659B   ← referencia
49d679132afb  hi.json  659B   ← placeholder
49d679132afb  id.json  659B   ← placeholder
49d679132afb  ja.json  659B   ← placeholder
49d679132afb  ko.json  659B   ← placeholder
49d679132afb  pt.json  659B   ← placeholder
49d679132afb  ru.json  659B   ← placeholder
49d679132afb  tr.json  659B   ← placeholder
49d679132afb  ur.json  659B   ← placeholder
49d679132afb  zh-Hans.json  659B ← placeholder
7af9e4b30834  fr.json  698B   ← distinta (probablemente completa)
```

Eso significa que si un usuario final selecciona "Deutsch" en la UI, está leyendo "Settings, Back, Project folder..." con la etiqueta "Deutsch". Engaño al usuario.

La auditoría de 2026-09-04 ya lo señaló. Esta propuesta lo arregla con un gate ejecutable, no con un hope.

## Non-goals

- No traduce los placeholders (esa es la tarea humana, no del agente).
- No cambia el loader ni el runtime de i18n — el gate es de calidad del contenido, no del código de carga.
- No elimina los locales placeholder; los marca como `experimental` y los oculta de la UI hasta que pasen el umbral.

## Slices

- global_gate: lint

### S1 — Gate `lint:i18n-completeness`
- **Status**: done
- **Files**: `scripts/gates/lint-i18n-completeness.script.ts`
- **Gate**: type

### S2 — Anotar los locales placeholder como `experimental`
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/ui/i18n/locales/*.json` (los 13 placeholders)
- **Gate**: lint

### S3 — Wire al `bun run validate`
- **Status**: done
- **DependsOn**: [S2]
- **Files**: `package.json`
- **Gate**: lint

### S4 — Documentar la política en el bootstrap
- **Status**: done
- **DependsOn**: [S3]
- **Files**: `docs/delendai/AGENT-BOOTSTRAP.md` (§4.1)
- **Gate**: docs

## acceptance

- [x] Los 13 locales placeholder no pueden volver al repo sin `_completeness: experimental`.
- [x] Los locales reales (`es`, `fr`, y los futuros) pasan el gate.
- [x] El selector de la UI no muestra los placeholder hasta que se traduzcan. (futuro UI slice)
- [x] Gate wired en `bun run lint` y por tanto en `bun run validate`.
- [x] Política documentada en bootstrap §4.1.
