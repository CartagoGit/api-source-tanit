---
id: x00049
kind: feat
title: "x00049: integration verifier — gate post-merge que detecta residuos de trabajo multiagente"
status: ready
priority: P1
globalGate: lint
why: |
  El análisis 2026-09-05/06 señaló un patrón recurrente en el
  trabajo multiagente de Tanit:

    - **Residuos de un agente que el siguiente tiene que limpiar**:
      rutas antiguas referenciadas (packages/plugins/delendai_tanit
      tras x00041), basura en la raíz (fichero `t`), workflows
      duplicando responsabilidad (validate.yml + integration-delendai.yml
      mientras x00041 estaba a medias), scripts apuntando a
      carpetas inexistentes (`typecheck:plugin`), propuestas con IDs
      duplicados (`x00041` archivada dos veces), frontmatter `done`
      con body `pending` (a00016).

    - **E2E desactivado en CI por una variable de entorno**
      (`TANIT_SKIP_MULTI_SERVICE_ISOLATION`) que ningún agente se
      atrevió a quitar sin arreglar el bug subyacente.

    - **Lockfile desincronizado de package.json** durante el
      refactor de workspaces.

  Ninguno de estos síntomas es detectado por los gates actuales.
  `lint:clean-tree` mira el worktree, no el historial.
  `lint:proposals` mira frontmatter, no paths referenciados.
  `lint:bootstrap-drift` mira bootstrap, no docs raíz.

  Lo que falta es un **integration verifier**: un gate que corre
  tras un merge a develop (en CI, en local, en una rama de
  auditoría) y responde preguntas mecánicas:

    1. ¿Hay paths antiguos referenciados? (grep)
    2. ¿Hay ficheros basura en la raíz no permitidos? (x00047)
    3. ¿Hay IDs duplicados en proposals/? (lint:proposals ya
       lo cubre parcialmente vía x00032)
    4. ¿Hay scripts apuntando a carpetas inexistentes? (stat)
    5. ¿Hay workflows duplicando responsabilidad? (análisis
       de triggers + paths)
    6. ¿El lockfile corresponde al package.json? (bun install
       --frozen-lockfile)
    7. ¿bun run validate pasa desde checkout limpio?
       (ya es CI, pero el verifier lo enuncia)
    8. ¿Hay env vars `*_SKIP_*` exportadas desde workflows
       del producto? (x00046 S3 propone un gate equivalente)
    9. ¿Hay commits con `TANIT_SKIP_*` re-introducidos tras
       un merge? (log)
   10. ¿HEAD CI está verde? (gh api, opcional)

  Sin esa capa, el siguiente agente (humano o IA) tiene que
  recordar todas estas preguntas y aplicarlas mentalmente.
  Con la capa, las preguntas son del gate; los agentes sólo
  tienen que leer el reporte.
nonGoals:
  - Reemplazar a `lint:clean-tree`, `lint:proposals`, ni
    `lint:bootstrap-drift`. El integration verifier los
    compone / añade.
  - Bloquear merges (eso es un check required en GitHub —
    b00002 futuro). El verifier detecta; el branch policy
    decide si bloquea.
  - Llamar APIs externas (gh, etc.) por defecto — eso es
    opcional y configurable. El verifier local es lo importante.
globalGate: lint
acceptance:
  - `bun run lint:integration-verifier` corre dentro de
    `bun run lint` y dentro de CI.
  - El gate falla con la lista exacta de offenders si
    cualquiera de las 10 preguntas responde "sí, hay residuo".
  - Las preguntas son configurables vía flags
    (`--skip=paths,dup-ids` etc.) para迭代 sin tocar el gate.
  - El gate NO requiere red (sólo filesystem + git local).
  - El gate tiene un modo `--explain` que imprime la
    intención de cada pregunta (para humanos que auditan).
  - El modo `--audit` corre el verifier contra `develop`
    (rama local) y reporta el estado completo.
slices:
  - sliceId: S1
    title: "feat(gates): lint:integration-verifier con las preguntas mecánicas"
    files:
      - scripts/gates/lint-integration-verifier.script.ts (nuevo)
      - package.json (scripts.lint)
    gate: lint
    dependsOn: []
    acceptance:
      - Implementa las preguntas locales como funciones con nombre
        (`checkObsoletePaths`, `checkDuplicateProposalIds`,
        `checkDanglingScripts`, `checkWorkflowOverlap`,
        `checkLockfileSync`). Las preguntas 2 (root-allowlist),
        7 (skip-env-vars) y 8 (clean-tree) se delegan a gates
        ya existentes (x00047, x00046 S3, c00005) que corren en
        la misma cadena `bun run lint` — recomponerlos aquí sería
        duplicar responsabilidad, no integrarla.
      - El gate orquesta las preguntas, agrega el reporte,
        y falla si alguna falla.
      - Modos `--explain`, `--audit` y `--skip=<ids>` funcionan.
      - `bun run lint` verde.
      - **Status**: done — el gate caza y cierra en su primera
        pasada real: 7 offenders (paths obsoletos en
        docker-compose/CONTRIBUTING/NAMING/READMEs/validate-package/
        root.helper.spec + duplicados a00016/a00017 en ready/).
    notes: |
      Size: M. Es el gate que faltaba. En su primera pasada encontró
      residuos reales — incluido un par de propuestas duplicadas
      (el patrón x00041 repetido en a00016/a00017).
  - sliceId: S2
    title: "ci(validate.yml): el integration verifier corre como step propio de validate"
    files:
      - .github/workflows/validate.yml
    gate: lint
    dependsOn: [S1]
    acceptance:
      - Un step explícito "Integration verifier" corre
        `bun run lint:integration-verifier --audit` DESPUÉS
        de "Validate", "Audit dependencies" y "Validate package".
      - Si falla, el PR se queda rojo con la lista exacta
        de offenders (los agentes pueden actuar sin tener
        que recordar todas las preguntas).
      - **Status**: done.
---

# x00049 — Integration verifier post-merge

## Contexto

El auditor 2026-09-05/06 observó que el trabajo multiagente
produce **valor técnico real pero integración incompleta**.
Las métricas: 8.6/10 en calidad técnica, 6.5/10 en coordinación.

La causa raíz no es que los agentes sean malos. Es que **el
proceso termina en el merge**: después de que N agentes commitean
sus slices, no hay nadie (humano ni herramienta) que haga la
pasada global. Los síntomas que el análisis enumeró son todos
detectables mecánicamente — la pasada global debería ser un
script, no un humano.

## Decisión

Un **integration verifier** ejecutable. No es un agente; es un
script que responde preguntas mecánicas. Las preguntas están
inspiradas en los residuos reales observados en
2026-09-05/06:

| # | Pregunta | Detector | Símoma real |
|---|----------|----------|-------------|
| 1 | ¿Hay paths antiguos referenciados? | `grep -rln 'packages/plugins/delendai_tanit'` excluyendo proposals/ | x00041 S1 movió la carpeta pero quedaron refs |
| 2 | ¿Hay ficheros basura en la raíz? | x00047 (allowlist) | fichero `t` |
| 3 | ¿Hay IDs duplicados en proposals/? | `lint:proposals` parcial | x00041 archivada dos veces |
| 4 | ¿Hay scripts apuntando a carpetas inexistentes? | `stat -c '%n' $(grep -oP '"\K[^"]+(?=/.*")' package.json#scripts)` | typecheck:plugin → ENOENT |
| 5 | ¿Hay workflows duplicando responsabilidad? | análisis de `on:` + paths | validate.yml + integration-delendai.yml durante x00041 |
| 6 | ¿El lockfile corresponde al package.json? | `bun install --frozen-lockfile` (ya en CI, pero el verifier lo enuncia) | bun.lock desfasado tras mover plugin |
| 7 | ¿bun run validate pasa desde checkout limpio? | (CI ya lo hace) | n/a |
| 8 | ¿Hay env vars `*_SKIP_*` exportadas desde workflows del producto? | grep en `.github/workflows/validate.yml` | TANIT_SKIP_MULTI_SERVICE_ISOLATION |
| 9 | ¿Hay commits con `TANIT_SKIP_*` re-introducidos? | `git log -G 'TANIT_SKIP_'` | patrón temporal permanente |
| 10 | ¿HEAD CI está verde? | `gh api` opcional | CI roja permanente |

## Diseño

### S1 — `lint:integration-verifier` script

```ts
// scripts/gates/lint-integration-verifier.script.ts

import { REPO_ROOT } from "../helpers/root_helper.js";
import { execSync } from "node:child_process";

interface IQuestion {
  id: string;
  title: string;
  check: () => Promise<string[]>; // devuelve offenders (vacío = OK)
}

const QUESTIONS: IQuestion[] = [
  { id: "obsolete-paths", title: "Path antiguos referenciados",
    check: checkObsoletePaths },
  { id: "root-allowlist", title: "Ficheros no permitidos en raíz",
    check: checkRootAllowlist },
  { id: "dup-ids", title: "IDs duplicados en proposals/",
    check: checkDuplicateProposalIds },
  { id: "dangling-scripts", title: "Scripts apuntando a carpetas inexistentes",
    check: checkDanglingScripts },
  { id: "workflow-overlap", title: "Workflows con responsabilidad duplicada",
    check: checkWorkflowOverlap },
  { id: "lockfile-sync", title: "bun.lock alineado con package.json",
    check: checkLockfileSync },
  { id: "skip-env-vars", title: "Env vars *_SKIP_* exportadas desde workflows",
    check: checkSkipEnvVars },
  { id: "skip-env-vars-log", title: "Commits reintroduciendo TANIT_SKIP_*",
    check: checkSkipEnvVarsInLog },
];
```

Cada `checkX` es una función pura que devuelve una lista de
offenders (vacía = OK). El gate orquesta, agrega, falla si
alguna falla.

### S2 — Wire en `validate.yml`

Un step explícito después de los otros:

```yaml
      - name: Integration verifier
        run: bun run lint:integration-verifier --audit
```

Si falla, el PR se queda rojo con la lista exacta de offenders.
Los agentes pueden actuar sin tener que recordar todas las
preguntas.

## Lo que NO hace

- **No bloquea merges por sí solo.** Eso es branch policy
  (b00002 futuro: checks required en develop).
- **No reemplaza a los gates existentes.** Los complementa:
  `lint:clean-tree` mira worktree, `lint:proposals` mira
  frontmatter, `lint:integration-verifier` mira residuos
  cross-cutting.
- **No llama a Delendai ni a GitHub por defecto.** La pregunta
  10 es opcional (`--with-ci`) y está deshabilitada en CI
  (sería recursivo).

## Por qué va después de x00047 y x00048

x00047 (allowlist) cubre la pregunta 2.
x00046 (multi-service) cubre la pregunta 8.
x00048 (a00016 S6) no toca residuos directamente pero deja el
codebase más coherente, así que cuando x00049 corre ve menos
ruido. El orden importa porque cada propuesta cierra uno o más
residuos antes de que el verifier los catalogue.

## Trabajo posterior (fuera de scope)

- **b00002**: branch policy — proteger `develop` con CI required.
  Hoy `develop` sigue sin checks obligatorios (el análisis lo
  señaló con 4.5/10 en CI real).
- **x00050** (futuro): allowlist de env vars permitidas en
  workflows (más estricto que el grep de la pregunta 8).
- **x00051** (futuro): dashboard del verifier (consume la salida
  del gate y la presenta en la UI desktop).

Estos los abordan otras propuestas. x00049 sólo establece el gate
y el step de CI.