---
id: c00005
title: "Higiene de worktree: residuos de agencia fuera del repo + gate de árbol limpio"
kind: chore
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-05
related:
  - x00032
---

# c00005 — El árbol de trabajo muestra lo que el agente usó como papel

## Goal

Que el repo no acumule ficheros temporales de la orquestación
(`.s1-msg.txt`, `.s2-msg.txt`, `.s3-msg.txt`, `n' hello-world`,
`et ZSH_VERSION`…) y que un gate impida que vuelvan a versionarse.

## Why

Las revisiones de 2026-09-04/05 lo señalan como evidencia del eslabón que
falta en el bucle multiagente:

```
implementation → reconciliation → clean tree check → acceptance → close
```

En el HEAD actual están **trackeados** por git:
`.s1-msg.txt`, `.s2-msg.txt`, `.s3-msg.txt` (los mensajes de commit de los
slices del agente, escritos en la raíz del repo). Y en el worktree principal
hay además entradas sin trackear generadas por el entorno/pruebas
(`et ZSH_VERSION`, `n' hello-world`, artefactos bajo
`examples/*/export-to-postman/` que `validate:examples` regenera).

Poca cosa por pieza; mucho como señal de que nadie mira el `git status`
antes de dar una tarea por terminada. Los mensajes de commit deben vivir
en `/tmp` o en el estado interno del orchestrator, nunca en el árbol que
se commitea.

## Non-goals

- No cambia el flujo de commits del agente (Conventional Commits sigue),
  solo dónde se guardan los mensajes temporales.
- No borra artefactos legítimos de `examples/` que `validate:examples`
  genera deliberadamente; esos se declaran en `.gitignore` con patrón.

## Slices

### S1 — Purga + ignore

- **Status**: done (S1 aplicado en este commit)
- **Files**: `.gitignore`, los tres `*.txt`
- **Detalle**: `git rm --cached` de los three residuos, añadir patrones
  (`.s*-msg.txt`, `__tanit_tmp/`, salida de `examples/*/export-to-postman/`
  si es regenerable). Los dos ficheros basura (`et ZSH_VERSION`, etc.) se
  eliminan del árbol local del agente.

### S2 — Gate `lint:clean-tree`

- **Status**: pending
- **Files**: `scripts/gates/lint-clean-tree.script.ts` (o extensión de un
  gate existente), añadido a `bun run validate`
- **Gate**: `bun run validate`
- **Detalle**: en modo CI (donde `git status --short` tras el build debe
  estar vacío), un paso del pipeline hace `git status --porcelain` y
  **falla** con la lista de ficheros desconocidos generados por el propio
  validate. Así se detecta "validate escribe en el árbol y nadie lo
  commitea ni lo ignora".

### S3 — Migrar los mensajes de slice del orchestrator a `.tanit/` (o `/tmp`)

- **Status**: pending
- **Files**: los scripts/placeholders del orquestador que hoy escriben
  `.sN-msg.txt` en la raíz
- **Gate**: `bun run lint` (S2)
- **Detalle**: escribir los mensajes transitorios bajo un directorio ya
  ignorado (`.tanit/orchestrator/`) y referenciarlos ahí.

## acceptance

1. `git ls-files | grep -E '\.s[0-9]+-msg\.txt'` vacío en develop.
2. El nuevo `git status` limpio tras `bun run validate` en CI.
3. S2 (gate) integrado en `bun run validate` y verde en Actions.
4. Los residuos nuevos no reaparecen en ≥ 3 runs seguidos del orquestador.
