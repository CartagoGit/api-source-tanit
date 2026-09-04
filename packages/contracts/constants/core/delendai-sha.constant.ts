/**
 * SHA pin al que se fija el checkout de `CartagoGit/delendai` en CI.
 *
 * El plugin
 * ([`packages/plugins/delendai_tanit`](../../../plugins/delendai_tanit/))
 * declara `@delendai/core` como dependencia `file:` contra
 * `../../../../delendai/packages/core`. En local eso resuelve contra el
 * checkout hermano del desarrollador; en CI el runner sólo hace checkout
 * del repo actual y el `bun install --frozen-lockfile` reventaba porque
 * ese path no existía.
 *
 * El workflow
 * [`.github/workflows/validate.yml`](../../../.github/workflows/validate.yml)
 * materializa ese checkout explícitamente con un segundo `actions/checkout@v7`
 * que clona `CartagoGit/delendai` en `../delendai` fijado a este SHA.
 * La decisión está documentada en
 * [`docs/delendai/proposals/ready/a00012-plan-de-estabilizacion-y-arquitectura-2026-09-04.md`](../../../docs/delendai/proposals/ready/a00012-plan-de-estabilizacion-y-arquitectura-2026-09-04.md)
 * (slice S0 — CI reproducible).
 *
 * ## Cómo se actualiza
 *
 * Esta constante es la **fuente de verdad del repositorio**. Cuando se
 * publique una nueva versión de `@delendai/core` y haya que subir el
 * pin, se cambia este valor, se regenera `bun.lock` y se actualiza el
 * `env.DELENDAI_SHA` del workflow con el mismo literal. Las dos
 * referencias se revisan en el mismo commit — son la misma decisión.
 *
 * El valor por defecto apunta a la cabecera de `develop` de
 * `CartagoGit/delendai` en el momento de cerrar S0 de `a00012`. Si en
 * el momento de un futuro corte `@delendai/core` se publica en npm, el
 * path `file:` se sustituye por `^<versión>` y este SHA deja de tener
 * efecto (ver `p00007` archivado en `done/chores/`).
 */
export const DELENDAI_SHA = "f86e0ee9ee79f2dc82e294bb0030547b1639dbc1";