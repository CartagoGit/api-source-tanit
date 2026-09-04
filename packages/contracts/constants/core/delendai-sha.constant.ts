/**
 * SHA pin that the CI pins the `CartagoGit/delendai` checkout to.
 *
 * The plugin
 * ([`packages/plugins/delendai_tanit`](../../../plugins/delendai_tanit/))
 * declares `@delendai/core` as a `file:` dependency pointing at
 * `../../../../delendai/packages/core`. Locally that resolves against
 * the developer's sibling checkout; in CI the runner only checks out
 * the current repo and `bun install --frozen-lockfile` would crash
 * because that path does not exist.
 *
 * The
 * [`.github/workflows/validate.yml`](../../../.github/workflows/validate.yml)
 * workflow materializes that checkout explicitly with a second
 * `actions/checkout@v7` cloning `CartagoGit/delendai` into `../delendai`
 * pinned to this SHA. The decision is documented in
 * [`docs/delendai/proposals/ready/a00012-plan-de-estabilizacion-y-arquitectura-2026-09-04.md`](../../../docs/delendai/proposals/ready/a00012-plan-de-estabilizacion-y-arquitectura-2026-09-04.md)
 * (slice S0 — reproducible CI).
 *
 * ## How to update
 *
 * This constant is the **single source of truth in the repository**.
 * When a new version of `@delendai/core` is published and the pin has
 * to move, change this value, regenerate `bun.lock`, and update the
 * workflow's `env.DELENDAI_SHA` to the same literal — both references
 * are reviewed in the same commit because they are the same decision.
 *
 * The default value points to `develop` of `CartagoGit/delendai` at
 * the moment S0 of `a00012` closed. If, at a future cut, `@delendai/core`
 * is published to npm, the `file:` path is replaced by `^<version>` and
 * this SHA becomes a no-op (see `p00007`, archived in `done/chores/`).
 */
export const DELENDAI_SHA = "916238276ddde5480914ce08ec571e70585606ce";