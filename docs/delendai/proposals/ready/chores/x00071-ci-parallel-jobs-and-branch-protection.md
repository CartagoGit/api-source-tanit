---
id: x00071
title: "x00068 follow-up: split CI into parallel jobs + apply develop branch protection"
kind: chore
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - x00068
shippedIn: []
---

# x00069 — CI parallelization + branch protection

## Goal

Cerrar las dos partes de x00068 que el audit del 2026-09-07 dio
por cerradas sin estarlo realmente:

1. **CI secuencial**: el workflow actual tiene **un único job
   `validate`** que ejecuta `typecheck + lint + test:coverage +
   validate:examples + bench:check` en serie. Un fallo de lint
   paraliza el resto. La propuesta original pedía 9 jobs paralelos.
2. **`develop` desprotegido**: GitHub sigue indicando
   `required_status_checks: []` y `protected: false`. El CI es
   excelente; la política de merge no existe.

La tercera parte de x00068 (security audit con `if: always()`)
**sí está cerrada** y sigue funcionando.

## Why (audit 2026-09-07 §5)

x00068 fue archivada como `done` cuando sólo se había hecho el
`if: always()` del audit. La parte de jobs paralelos y la de
branch protection siguen pendientes. El audit del 2026-09-07 lo
canta sin reparos:

> Está marcada como `done`, pero su propia propuesta habla de:
> - 9 jobs paralelos;
> - branch protection en `develop`;
> - required status checks.
> Sin embargo, el workflow actual continúa teniendo **un único job
> `validate` secuencial**.
> Y GitHub sigue indicando `protected: false`,
> `required_status_checks: []`.

Esta propuesta reabre x00068 con dos slices:

### Slice S1 — CI en jobs paralelos

**Files**:

- `.github/workflows/validate.yml`: convertir el job monolítico en
  los 9 jobs paralelos que la propuesta original listaba (o los
  que cubran el mismo set de gates, agrupando por tiempo). Cada
  job con `needs: []` para arrancar a la vez, y un job final
  `ci-summary` con `needs: [todos]` que汇总 los resultados y emite
  el reporte.

- `package.json`: cada job paralelo es un script discreto que ya
  existe (`typecheck`, `lint`, `test:coverage`,
  `validate:examples`, `bench:check`). No hay que añadir nada.

- `scripts/build/ci-summary.script.ts`: nuevo script que recoge
  los artefactos de cada job y emite un `GITHUB_STEP_SUMMARY`
  con la tabla de resultados. Sustituye al log monolítico.

**Gate**: `bun run typecheck && bun run lint && bun run test:coverage && bun run validate:examples && bun run bench:check` (igual que antes; el cambio es de orquestación, no de cobertura).

### Slice S2 — branch protection en `develop`

**Files**:

- `.github/workflows/protect-develop.yml`: nuevo workflow que
  configura `protected: true` y `required_status_checks: [todos
  los nuevos jobs]` vía la API REST de GitHub. Sólo corre cuando
  se mergea contra `develop` (gate de admin).

- `docs/CI.md`: documentar la nueva política de protección, qué
  checks son required, y qué pasa si uno falla.

**Gate**: `gh api repos/:owner/:repo/branches/develop | jq '.protection'` muestra `required_status_checks` no vacío.

## Approach para S1

El job monolítico actual:

```yaml
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run validate
```

Se convierte en:

```yaml
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps: … → bun run typecheck
  lint:
    runs-on: ubuntu-latest
    steps: … → bun run lint
  test-coverage:
    runs-on: ubuntu-latest
    steps: … → bun run test:coverage
  validate-examples:
    runs-on: ubuntu-latest
    steps: … → bun run validate:examples
  bench-check:
    runs-on: ubuntu-latest
    steps: … → bun run bench:check
  ci-summary:
    needs: [typecheck, lint, test-coverage, validate-examples, bench-check]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bun run scripts/build/ci-summary.script.ts
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: ci-report, path: ci-report.md }
```

Tiempo total: pasa de `~25 min` (secuencial) a `~8 min` (el job
más lento, `test:coverage`). Es la diferencia entre CI usable y CI
que el equipo deja de mirar.

## Acceptance

- 5+ jobs paralelos en `.github/workflows/validate.yml`, todos con
  `needs: []`.
- Job `ci-summary`汇总 los resultados y emite un markdown en
  `$GITHUB_STEP_SUMMARY`.
- `gh api repos/CartagoGit/api-source-tanit/branches/develop`
  devuelve `protected: true` con `required_status_checks` no vacío.
- CI verde en `develop` con la nueva configuración.

## Risks

- **Coste de minutos**: 5 jobs paralelos × ~5 min ≈ 25 min de
  runner, frente a ~25 min del secuencial. Mismo coste total,
  mitad de wall-clock. Si budget es un problema, podemos combinar
  `lint` y `typecheck` en un job y dejar los demás paralelos (4
  jobs).
- **Falsos negativos**: con `if: always()` se reportan tanto
  éxitos como fallos. Hay que vigilar que `ci-summary` no se
  trague un fallo real.
- **Branch protection retroactiva**: aplicar protección en
  `develop` mientras hay PRs abiertos podría romper merges
  pendientes. Coordinar con el equipo antes de activar.

## Cross-references

- [`x00068`](../in-progress/chores/x00068-ci-parallel-jobs-and-develop-branch-protection.md)
  — propuesta original, parcialmente completada (sólo
  `security:audit + always()`).
- [`x00062`](../done/refactors/x00062-fix-core-frameworks-architectural-regression-language-ir.md)
  — referencia análoga para refactors arquitecturales
