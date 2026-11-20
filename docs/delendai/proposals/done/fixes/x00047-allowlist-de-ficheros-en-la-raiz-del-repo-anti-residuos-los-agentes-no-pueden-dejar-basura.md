---
id: x00047
kind: chore
title: "x00047: allowlist de ficheros en la raíz del repo — anti-residuos (los agentes no pueden dejar basura)"
status: done
priority: P1
globalGate: lint
shippedIn:
  - d554d1f
why: |
  El `lint:clean-tree` actual detecta **basura en el árbol de trabajo**
  (modified / untracked / staged-or-deleted). Sirve para que un agente
  no commitee sin darse cuenta. Lo que NO detecta es **basura ya
  commiteada** en commits previos: un fichero que un agente metió con
  `git add .` por error y que llegó al historial.

  El caso real del 2026-09-05/06 fue el fichero `t` (13 KB, output
  accidental de `less` — una redirección interactiva que el agente
  volcó a un fichero llamado `t`). Se committeó, se quedó en
  `develop`, y `lint:clean-tree` no lo cazaba porque ya estaba
  tracked. x00045 S? lo borró en este PR, pero el patrón volverá a
  ocurrir si no se cierra la puerta.

  La solución: una **allowlist explícita** de paths permitidos en la
  raíz del repo. Si un agente commitea un fichero que no está en la
  allowlist, el gate falla. La allowlist se mantiene pequeña y
  documentada.

  Los `.gitignore`s atrapan otra clase de basura (logs, caches, etc.),
  pero un `.gitignore` demasiado generoso esconde trabajo real; una
  allowlist es más estricta y deja claro qué se considera "raíz del
  proyecto".
nonGoals:
  - Reemplazar `.gitignore` (sigue siendo la política de "ignorar";
    la allowlist es la política de "qué puede commit-earse").
  - Auditar históricamente el repo en busca de otros ficheros basura
    (x00045 ya borró `t`; no se ha encontrado otro similar — un
    `git ls-files` de la raíz actual muestra sólo paths legítimos).
  - Proteger contra scripts que escriban dentro de subcarpetas
    (eso ya está cubierto por `lint:clean-tree` + `.gitignore`).
globalGate: lint
shippedIn:
  - d554d1f
acceptance:
  - El gate `lint:root-allowlist` corre dentro de `bun run lint`
    (parte de `validate`).
  - El gate enumera `git ls-files` en la raíz del repo y compara
    con una lista blanca versionada.
  - La lista blanca es **explícita** (un fichero por línea en
    `scripts/gates/root-allowlist.ts` o similar) y documenta
    por qué cada entrada está permitida.
  - Si alguien commitea un fichero en la raíz que no está en la
    allowlist, el gate falla con la lista exacta de offenders
    y el patrón de la allowlist.
  - `bun run lint` sigue verde tras añadir la allowlist
    (los paths actuales son todos legítimos).
  - El gate tiene un escape `TANIT_ALLOW_ROOT_FILES=1` para
    excepciones documentadas (no para saltarse el gate en general).
slices:
  - sliceId: S1
    title: "chore(gates): lint:root-allowlist — enumerar paths de raíz, comparar con allowlist"
    files:
      - scripts/gates/lint-root-allowlist.script.ts (nuevo)
      - package.json (scripts.lint)
    gate: lint
    dependsOn: []
    acceptance:
      - El gate lista los paths commiteados en la raíz del repo
        (`git ls-files | awk -F/ '{print $1}' | sort -u` o
        equivalente Bun).
      - Compara con una allowlist hardcodeada con motivo por
        entrada (`AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`,
        `CONTRIBUTING.md`, `LICENSE`, `README.md`, `delendai.config.json`,
        `package.json`, `tsconfig*.json`, `vitest.config.ts`,
        `bin/`, `coverage/`, `docs/`, `examples/`, `export-to-postman/`,
        `integrations/`, `packages/`, `scripts/`, `tests/`).
      - Falla con offenders y referencia al path de la allowlist
        si hay un mismatch.
      - `TANIT_ALLOW_ROOT_FILES=1` desactiva el gate (escape
        documentado).
      - El gate corre dentro de `bun run lint` (añadir a la
        cadena de `scripts` en `package.json`).
      - `bun run lint` verde localmente.
---

# x00047 — Allowlist de raíz

## Contexto

`lint:clean-tree` (`scripts/gates/lint-clean-tree.script.ts`) ya
existe y protege contra basura en el árbol de trabajo. Pero ese
gate lee `git status`, que **no reporta ficheros tracked**. Si un
agente commitea basura (por error, por `git add .` descuidado, por
un pipe mal dirigido), `lint:clean-tree` no lo ve.

El incidente del fichero `t` (13 KB de ayuda de `less` commiteada
en develop) lo demuestra. El gate existía, estaba verde, y el
worktree tenía basura igualmente.

## Decisión

Una **allowlist explícita** versionada en el gate. La forma
operativa:

```ts
// scripts/gates/lint-root-allowlist.script.ts

/**
 * Allowlist versionada de paths permitidos en la raíz del repo.
 *
 * Cada entrada se justifica: si la quitas, documenta por qué.
 * El gate falla si un fichero commiteado en la raíz no está aquí.
 */
const ALLOW = [
  "AGENTS.md",            // Pointer a AGENT-BOOTSTRAP.md
  "CHANGELOG.md",         // Cambios visibles por release
  "CLAUDE.md",            // Pointer a AGENT-BOOTSTRAP.md
  "CONTRIBUTING.md",      // Cómo contribuir
  "LICENSE",              // MIT
  "README.md",            // Entrada del repo
  "delendai.config.json", // Config del host MCP
  "package.json",         // Manifiesto del producto
  "tsconfig.base.json",   // Base del typecheck
  "tsconfig.cli.json",    // Section CLI
  "tsconfig.contracts.json",
  "tsconfig.core.json",
  "tsconfig.frameworks.json",
  "tsconfig.json",        // Aggregator
  "vitest.config.ts",     // Config de vitest
  "bin/",                 // Lanzador del CLI
  "coverage/",            // Salida de vitest coverage (gitignored)
  "docs/",                // Documentación
  "examples/",            // Proyectos de ejemplo
  "export-to-postman/",   // Salida de generate sobre example-app
  "integrations/",        // Integraciones opcionales (x00041)
  "packages/",            // Producto (cli, core, contracts, frameworks)
  "scripts/",             // Gates y helpers
  "tests/",               // Suites del producto
] as const;
```

El gate hace:

```ts
const committed = execSync("git ls-files", { cwd: REPO_ROOT })
  .toString().trim().split("\n")
  .map((p) => p.split("/")[0]!);
const offenders = [...new Set(committed)]
  .filter((root) => !ALLOW.includes(root));
if (offenders.length > 0) fail(...);
```

## Por qué NO confío en `.gitignore`

`.gitignore` es la política de "ignorar". Si lo amplío para
cubrir nombres "raros" como `t`, `n`, `et`, etc., estoy siendo
**generoso con basura potencial**: si mañana un agente legítimo
quiere crear un fichero de tests llamado `t.test.ts`, se lo come.

Una allowlist es lo contrario: **estricta con lo permitido**. La
raíz del repo tiene una identidad clara; cualquier fichero ahí
debe justificarse.

## Lo que NO cambia

- `.gitignore` sigue igual.
- `lint:clean-tree` sigue igual.
- Los workflows siguen iguales.
- El path `t` ya está borrado (x00045); la allowlist documenta
  qué paths SÍ están permitidos, no añade paths nuevos.

## Por qué esto va antes que el resto de P1

Si un agente, después de x00045, vuelve a dejar basura en la raíz
y commitea, `lint:clean-tree` no lo va a ver. La allowlist cierra
la puerta al patrón completo, no sólo al incidente. Sin ella,
`x00045` habrá sido un fix de un solo `t` y no una mejora de
proceso.