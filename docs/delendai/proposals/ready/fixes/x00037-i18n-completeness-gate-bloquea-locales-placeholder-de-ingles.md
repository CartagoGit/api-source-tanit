---
id: x00037
title: "i18n completeness gate - bloquea locales placeholder de inglés"
kind: fix
status: ready
type: proposal
track: general
date: 2026-09-05
---

# x00037 — i18n completeness gate: bloquea locales placeholder de inglés

## Goal

Detectar y rechazar en CI los locales i18n cuyo contenido es idéntico
(byte-a-byte o por encima de un umbral de completitud) al locale inglés
referencia. Hoy 13 de los 15 locales en `packages/ui/i18n/locales/`
comparten el hash sha256 `49d679132afb` con `en.json` — son placeholders
etiquetados como si fueran idiomas traducidos.

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

Eso significa que si un usuario final selecciona "Deutsch" en la UI,
está leyendo "Settings, Back, Project folder..." con la etiqueta "Deutsch".
Engaño al usuario.

La auditoría de 2026-09-04 ya lo señaló. Esta propuesta lo arregla con un
gate ejecutable, no con un hope.

## Non-goals

- No traduce los placeholders (esa es la tarea humana, no del agente).
- No cambia el loader ni el runtime de i18n — el gate es de calidad del
  contenido, no del código de carga.
- No elimina los locales placeholder; los marca como `experimental` y
  los oculta de la UI hasta que pasen el umbral.

## Slices

- global_gate: lint

### S1 — Gate `lint:i18n-completeness`

- **Status**: pending
- **Files**: `scripts/gates/lint-i18n-completeness.script.ts`
- **Gate**: type
- **Acceptance**: el script compara cada locale contra `en.json` (o el locale configurado como referencia). Falla si la similitud (Jaccard sobre keys) ≥ 0.99 O si el número de claves distintas al inglés es ≤ 2. Los locales `es.json` y `fr.json` pasan; el resto falla con un mensaje claro: "locale <x> es placeholder de inglés (X% overlap)".

### S2 — Anotar los locales placeholder como `experimental`

- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `packages/ui/i18n/locales/*.json` (los 13 placeholders)
- **Gate**: lint
- **Acceptance**: cada locale placeholder gana un campo `_completeness: "experimental"` y un `_referenceSha: "<sha de en.json>"` en su metadata. El loader de la UI lee `_completeness` y oculta el locale del selector mientras no esté >= 95%.

### S3 — Wire al `bun run validate`

- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `package.json`
- **Gate**: lint
- **Acceptance**: `bun run validate` ejecuta `lint:i18n-completeness` y falla con código distinto de 0 si hay locales placeholder sin anotar.

### S4 — Documentar la política en el bootstrap

- **Status**: pending
- **DependsOn**: [S3]
- **Files**: `docs/delendai/AGENT-BOOTSTRAP.md` (nuevo §4.x)
- **Gate**: docs

## Acceptance

- Los 13 locales placeholder no pueden volver al repo sin `_completeness: experimental`.
- Los locales reales (`es`, `fr`, y los futuros) pasan el gate.
- El selector de la UI no muestra los placeholder hasta que se traduzcan.
