/**
 * Catalog of response inferrers (proposal `r00020` S3).
 *
 * Same case as `FRAMEWORK_IDS` and `EXPORTER_FORMATS`, and for the
 * same reason: the list is **data**, and the registry is what fulfills
 * it. Deriving the list from the registry would force every consumer
 * that wants to read ten strings to import ten inferrer
 * implementations — and, with them, the regexes and parsers of PHP,
 * Go, Ruby and Kotlin behind.
 *
 * ## The ids are not framework ids
 *
 * An inferrer serves a framework, but the two are not the same thing:
 *
 * - `laravel-resources` serves the `laravel` framework — only the
 *   slice of it that returns a `JsonResource`.
 * - `rails-render` serves `rails` — only the actions that `render
 *   json:`.
 * - `ktor-respond` serves `ktor` — only the handlers that call
 *   `call.respond`.
 *
 * So the **id** names the inferrer and the **framework** names the
 * slug the registry selects it with. The mapping below is the single
 * source of truth for that relationship; a test compares it against
 * the registry and fails if one is missing or extra.
 *
 * ## The four legacy inferrers
 *
 * `spring`, `nestjs`, `fastapi` and `aspnet` existed before this
 * slice. They keep their behaviour and their names; what changed is
 * the contract they implement (`IResponseInferrer` moved to
 * `response-inferrer.interface.ts` and speaks routes instead of
 * endpoint projections).
 */

/**
 * The inferrers this repository ships.
 *
 * Ten entries: the four that existed plus the six added in
 * `r00020` S3 (Fastify, Express, Laravel Resources, Gin, Rails
 * render, Ktor `call.respond`).
 */
export const RESPONSE_INFERRER_IDS = [
  "spring",
  "nestjs",
  "fastapi",
  "aspnet",
  "fastify",
  "express",
  "laravel-resources",
  "gin",
  "rails-render",
  "ktor-respond",
] as const;

/** The id of a response inferrer. */
export type ResponseInferrerId = (typeof RESPONSE_INFERRER_IDS)[number];

/**
 * The framework slug each inferrer is selected with.
 *
 * `spring` is the odd one out: the framework is called `springboot`
 * in `FRAMEWORK_IDS`, and the inferrer kept the short name it was
 * born with. The mapping is what makes that harmless.
 */
export const RESPONSE_INFERRER_FRAMEWORKS: Readonly<
  Record<ResponseInferrerId, string>
> = {
  spring: "springboot",
  nestjs: "nestjs",
  fastapi: "fastapi",
  aspnet: "aspnet",
  fastify: "fastify",
  express: "express",
  "laravel-resources": "laravel",
  gin: "gin",
  "rails-render": "rails",
  "ktor-respond": "ktor",
};

/**
 * Coverage baseline — the percentage of operations each inferrer is
 * expected to resolve, measured on the reference fixtures in
 * `tests/fixtures/<framework>-responses/`.
 *
 * **What it is for.** The coverage reporter runs at the end of the
 * pipeline and prints the real numbers. This table is the *frozen
 * reference*: a framework that suddenly drops below it has regressed,
 * and the reporter says so.
 *
 * **What it is not.** It is **not** a gate. The reporter is a
 * diagnostic: it logs, it never fails the generation. A baseline that
 * blocks would turn a percentage into a build-breaker, and the
 * percentage moves for reasons that have nothing to do with a defect
 * (a new framework version, a fixture that grew a route the inferrer
 * does not model yet).
 *
 * The numbers are the ones measured on the fixtures at the time this
 * slice landed, and `tests/core/response-inference/coverage.spec.ts`
 * pins them: if an inferrer starts resolving fewer of its own
 * fixture's routes, that test fails.
 *
 * See `docs/RESPONSE-INFERENCE.md` for the full table and the method.
 */
export const RESPONSE_INFERENCE_COVERAGE_BASELINE: Readonly<
  Record<ResponseInferrerId, number>
> = {
  spring: 100,
  nestjs: 100,
  fastapi: 100,
  aspnet: 100,
  fastify: 100,
  express: 100,
  "laravel-resources": 100,
  gin: 100,
  "rails-render": 100,
  "ktor-respond": 100,
};
