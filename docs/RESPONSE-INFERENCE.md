# Response inference — the ten inferrers

What an API **returns** is as much a part of its contract as what it
accepts, and Tanit infers it. This document says what the inference
knows today, how each framework's inferrer reads it, and how the
coverage of the feature is measured.

## The contract

Every inferrer answers the same two questions:

```ts
interface IResponseInferrer {
  readonly framework: string;
  detect(framework: string, route: IResponseRoute): boolean;
  infer(route: IResponseRoute, ctx: IResponseInferContext): IResponseSpec | null;
}
```

- `detect` is the cheap question: *is this my framework, and does this
  route look like one I can infer?* It runs before any parsing.
- `infer` is the expensive one: *what does this route return?* It
  returns the responses it can **prove** from the source, or `null`
  when it cannot prove any. `null` and an empty list are different
  statements, and the contract says so.

The contract lives in
`packages/contracts/interfaces/core/response-inferrer.interface.ts`.
The route it reads (`IResponseRoute`) is the intersection of what the
scanners produce (`ParsedRoute`) and what the dispatcher has while
enriching a spec (`EndpointSpecLike`), so the same inferrer serves
the pipeline and the direct calls.

### No generic engine

Each framework has its **own** implementation. That is not redundancy
for its own sake: the output model of each framework is structurally
different. Spring declares responses with an annotation, Fastify with
a JSON Schema, Express with a `res.json()` call whose payload is an
object literal, Laravel with a Resource class, Gin with `c.JSON`,
Rails with `render json:` and Ktor with `call.respond`. A rule engine
that covered the common 60% would leave the rest ambiguous — and
"ambiguous" here means **confidently wrong**, which is worse than "not
inferred".

## The ten inferrers

| Id | Framework | The signal it reads | Confidence | Reference fixture | Baseline |
|---|---|---|---|---|---|
| `spring` | `springboot` | `@ApiResponse`, `ResponseEntity<T>` | high | — | not measured |
| `nestjs` | `nestjs` | `@ApiOkResponse`, `@ApiCreatedResponse`, return type | high | `tests/fixtures/nestjs-response-inference/` | 100% |
| `fastapi` | `fastapi` | `response_model=…` | high | — | not measured |
| `aspnet` | `aspnet` | `ProducesResponseType`, `ActionResult<T>` | high | — | not measured |
| `fastify` | `fastify` | `schema.response.<status>` (JSON Schema) | high | `tests/fixtures/fastify-responses/` | 66.7% |
| `express` | `express` | `res.json(…)`, `res.status(n).json(…)` | medium | `tests/fixtures/express-responses/` | 75% |
| `laravel-resources` | `laravel` | `new XResource(…)`, `XResource::collection(…)`, `toArray()` | high | `tests/fixtures/laravel-resources/` | 100% |
| `gin` | `gin` | `c.JSON(status, gin.H{…})` | medium | `tests/fixtures/gin-responses/` | 100% |
| `rails-render` | `rails` | `render json: …` | medium | `tests/fixtures/rails-render/` | 100% |
| `ktor-respond` | `ktor` | `call.respond(HttpStatusCode.X, …)` | medium | `tests/fixtures/ktor-responses/` | 100% |

The four that predate this slice live next to their scanners, in
`packages/frameworks/scanners/`. The six that arrived with it live in
`packages/core/response-inference/`. The registry that composes them
is `packages/core/responses/registry.ts`, and the catalog that
declares which inferrers exist is
`packages/contracts/constants/core/response-inference.constant.ts`.

### The id is not the framework

`laravel-resources` serves the `laravel` framework — only the slice
of it that answers with a `JsonResource`. `rails-render` serves
`rails`, and `ktor-respond` serves `ktor`. The **id** names the
inferrer; the **framework** names the slug the registry selects it
with. The mapping in the catalog is the single source of truth for
that relationship, and a test compares it against the registry.

### One framework, one inferrer

The registry is keyed by framework slug. A second inferrer for the
same framework **replaces** the first: stacking two inferrers for
Spring would make the result depend on the import order, which is not
a property anybody can reason about.

## Cross-file frameworks

Rails and Laravel declare their routes in one file and their responses
in **another**: `config/routes.rb` and `app/controllers/users_controller.rb`;
`routes/api.php` and `app/Http/Controllers/UserController.php`. Their
inferrers read the controller through `ctx.readSource`, a resolver the
dispatcher owns. The inferrer stays a pure function of the text it
reads, and a caller with no project on disk simply leaves the resolver
out.

When the controller **can** be read and it does not use the construct
the inferrer understands (a Laravel controller that returns a plain
model, a Rails action that renders HTML), the inferrer answers `null`.
Falling back to the convention there would answer "OrderResource" for
a response nobody returns — and a confidently wrong answer is worse
than no answer.

## The coverage reporter

`packages/core/responses/coverage-reporter.ts` measures the
percentage of **operations** for which the inferrer produced at least
one response, per framework. It runs at the end of the pipeline and
logs a diagnostic. It is **not** a gate: a percentage is not a
verdict, an endpoint may legitimately have no inferrable response,
and a baseline that blocks would turn a measurement into a
build-breaker.

The frozen reference lives in
`packages/contracts/constants/core/response-inference.constant.ts`
(`RESPONSE_INFERENCE_COVERAGE_BASELINE`), next to the fixture each
number was measured on (`RESPONSE_INFERENCE_REFERENCE_FIXTURES`).

### How the numbers are measured

1. The framework's scanner runs over its reference fixture.
2. Every route it reports is handed to the inferrer.
3. The percentage is the routes that got a response, over the routes
   that were declared.

The routes of each fixture are written down in
`tests/helpers/response-inference-routes.helper.ts` so the
measurement is reproducible without a scanner in the loop, and
`tests/frameworks/response-inference-routes.spec.ts` checks that the
scanners still report them. When a scanner changes, that spec fails
and the baseline has to be measured again.

A baseline of `null` means nobody measured that inferrer yet: the four
that predate this slice and have no response fixture of their own.
The reporter prints their number and stays quiet about it.

### What the baseline is, and what it is not

The baseline is a **reference measurement**: the percentage the
inferrer reaches on **its own fixture**. It is what
`tests/response-inference/coverage.spec.ts` pins, and it is what
detects an inferrer that starts resolving fewer of the routes it used
to.

It is **not** a threshold to apply to any project. A real project has
other code — a controller that answers with a plain array, a route the
scanner never reported, a construct the inferrer does not model — so
the tool will print a lower number there. The reporter names the
framework, prints the number and says what the comparison means; it
does not accuse the inferrer of something the project did.

That is why the run over `examples/` reads `express: 1/14 (7.1%)`
next to a `75%` reference baseline: the example project answers most
of its routes with constructs the Express inferrer does not model. It
is not a regression, and the message says so.

## The tests

- `tests/response-inference/fastify.spec.ts`
- `tests/response-inference/express.spec.ts`
- `tests/response-inference/laravel-resources.spec.ts`
- `tests/response-inference/gin.spec.ts`
- `tests/response-inference/rails-render.spec.ts`
- `tests/response-inference/ktor-respond.spec.ts`
- `tests/response-inference/registry.spec.ts`
- `tests/response-inference/coverage.spec.ts`
- `tests/response-inference/edge-cases.spec.ts` — malformed input every
  inferrer has to survive

Run them with:

```
bun run test:core
```
