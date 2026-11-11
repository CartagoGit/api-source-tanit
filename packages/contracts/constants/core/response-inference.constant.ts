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
 * The fixture each inferrer's coverage is measured on.
 *
 * The coverage reporter runs at the end of the pipeline and prints the
 * real numbers. This table says **where** those numbers come from, so
 * a reader can reproduce them: run the framework's scanner over the
 * fixture, run the inferrer over every route it reports, and count the
 * routes that got a response.
 *
 * `null` means the framework has **no reference fixture** yet: its
 * baseline is `null` too, and the reporter prints its number without
 * saying anything about it.
 */
export const RESPONSE_INFERENCE_REFERENCE_FIXTURES: Readonly<
  Record<ResponseInferrerId, string | null>
> = {
  spring: null,
  nestjs: "nestjs-response-inference",
  fastapi: null,
  aspnet: null,
  fastify: "fastify-responses",
  express: "express-responses",
  "laravel-resources": "laravel-resources",
  gin: "gin-responses",
  "rails-render": "rails-render",
  "ktor-respond": "ktor-responses",
};

/**
 * Coverage baseline — the percentage of operations each inferrer
 * resolves on its reference fixture.
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
 * The numbers are the ones measured on the fixtures named in
 * `RESPONSE_INFERENCE_REFERENCE_FIXTURES`, and
 * `tests/response-inference/coverage.spec.ts` pins them: if an
 * inferrer starts resolving fewer of its own fixture's routes, that
 * test fails.
 *
 * A `null` baseline is an inferrer nobody measured yet — the four that
 * predate this slice and have no response fixture of their own. The
 * reporter prints their number and stays quiet about it.
 *
 * A baseline **below 100** is not a defect: it is a fixture that
 * carries a route the inferrer cannot prove. `express` answers 3 of
 * the 4 routes of its fixture (the fourth sends a plain string) and
 * `fastify` 2 of 3 (the third declares no schema). `gin` answers 6
 * of 7: the last one renders an empty collection, which carries no
 * field to prove. The number is what the fixture measures, not a
 * target anybody has to hit.
 *
 * See `docs/RESPONSE-INFERENCE.md` for the full table and the method.
 */
export const RESPONSE_INFERENCE_COVERAGE_BASELINE: Readonly<
  Record<ResponseInferrerId, number | null>
> = {
  spring: null,
  nestjs: 100,
  fastapi: null,
  aspnet: null,
  fastify: 66.7,
  express: 75,
  "laravel-resources": 100,
  gin: 85.7,
  "rails-render": 100,
  "ktor-respond": 100,
};
