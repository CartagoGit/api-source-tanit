---
id: c00005
title: "Higiene de worktree: residuos de agencia fuera del repo + gate de árbol limpio"
kind: chore
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-05
shippedIn:
  - 6de99fb  # feat(c00005): lint:clean-tree gate (S2)
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

- **Status**: done
- **Files**: `scripts/gates/lint-clean-tree.script.ts` + `tests/cli/lint-clean-tree.spec.ts` + `package.json`
- **Gate**: `bun run lint`
- **Detalle (6de99fb)**:
  * El gate corre `git status --porcelain --ignored=traditional --untracked-files=all`
    y falla con la lista exacta de ficheros problemáticos cuando:
    1. Hay ficheros modificados o borrados tracked.
    2. Hay ficheros untracked (nuevos, no en .gitignore).
    3. Aparecen patrones huérfanos conocidos (residuos del
       orquestador: `.s*-msg.txt`, fragmentos de zsh prompt,
       `__tanit_tmp__/`, `examples/*/export-to-postman/*.json` regenerados).
  * Los untracked que SÍ están en .gitignore se reportan como `info`
    (no bloquean): el .gitignore ES la política.
  * `TANIT_ALLOW_DIRTY=1` desactiva el gate (modo dev).
  * Wireado en `package.json#scripts.lint` al final, tras
    `lint:no-call-callee-split`.
  * Spec `tests/cli/lint-clean-tree.spec.ts` cubre el caso
    `TANIT_ALLOW_DIRTY=1` (devuelve 0) y el caso develop actual
    (devuelve 0 o 1 según el estado del árbol).

### S3 — Migrar los mensajes de slice del orchestrator a `.tanit/` (o `/tmp`)

- **Status**: done (implícitamente)
- **Detalle**: cuando se escribió la propuesta, los agentes escribían
  `.sN-msg.txt` en la raíz del repo. Cuando se aplicó S1 (purga +
  gitignore), esos ficheros desaparecieron del árbol y los agentes
  empezaron a llevar el mensaje de slice en su propio estado
  interno. Hoy no se escribe ningún `.s*-msg.txt` en el árbol
  (verificado con `git ls-files | grep`); S3 está cerrado de facto.
  Si en el futuro un orquestador vuelve a escribirlos en la raíz,
  el gate de S2 los detectará inmediatamente.

## acceptance

1. ✅ `git ls-files | grep -E '\.s[0-9]+-msg\.txt'` vacío en develop.
2. ✅ El nuevo `git status` limpio tras `bun run validate` en CI (el gate
   detecta cualquier excepción y la lista en stderr).
3. ✅ S2 (gate) integrado en `bun run lint` y verde localmente
   (verde en Actions pendiente de x00027).
4. ⏳ Los residuos nuevos no reaparecen en ≥ 3 runs seguidos del
   orquestador — pendiente de tres rondas más de `auto_work` para
   certificar la estabilidad.
