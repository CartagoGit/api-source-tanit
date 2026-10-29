/**
 * Response inference contract (proposal `r00020` S3).
 *
 * ## Why a second contract
 *
 * `responses.interface.ts` already carries the response-inference
 * types, and its `IResponseInferrer` worked for the four frameworks
 * that existed when it was written (Spring, NestJS, FastAPI,
 * ASP.NET). It is **not** agnostic, and it is not extensible:
 *
 *   - The discriminator is a free-form `framework: string`, so
 *     nothing stops two inferrers claiming the same framework and
 *     nothing says which one wins.
 *   - `infer()` takes `(spec, source)` — an *endpoint* projection and
 *     a *file*. It cannot see the route as the scanner saw it, so an
 *     inferrer that needs the route's own metadata (the handler name,
 *     the controller, the prefix chain) has nowhere to read it from.
 *   - It returns a **list** of entries or nothing, and the caller has
 *     to guess whether "no entries" means "no signal" or "no
 *     response body".
 *
 * This file replaces that shape with one that is **agnostic** (it
 * speaks about routes and responses, not about frameworks), **total**
 * (every inferrer answers the same two questions) and **explicit**
 * (`null` means "this route has no inferrable response", which is a
 * different statement from "an empty list").
 *
 * ## The two questions
 *
 * - `detect(framework, route)` — *is this my framework, and does this
 *   route look like one I can infer?* It is the cheap check that runs
 *   before any parsing. An inferrer for Laravel Resources answers
 *   `true` for a Laravel route whose controller returns a Resource and
 *   `false` for one that returns a plain array.
 * - `infer(route, ctx)` — *what does this route return?* It reads the
 *   source through `ctx.source` and returns the responses it can
 *   prove, or `null` when it cannot prove any.
 *
 * ## No generic engine
 *
 * Every framework gets its **own** implementation. That is not
 * redundancy for its own sake: the output model of each framework is
 * structurally different. Spring declares responses with an
 * annotation, Fastify with a JSON Schema, Express with a
 * `res.json()` call whose payload is an object literal, Laravel with
 * a Resource class, Gin with `c.JSON`, Rails with `render json:` and
 * Ktor with `call.respond`. A rule engine that covered the common 60%
 * would leave the rest ambiguous — and "ambiguous" here means
 * confidently wrong, which is worse than "not inferred".
 *
 * ## The `IResponseSpec` name
 *
 * The operation IR already has an `IResponseSpec`
 * (`operation.interface.ts`): an **open bag** for the response of a
 * published operation. The one declared here is a different thing —
 * the *inferred* response of a route, with a known shape. They are
 * not interchangeable and they are never used together: the operation
 * IR is built **from** the inferred responses, downstream.
 */
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
  IResponseInference,
} from "./responses.interface.js";
import type { ResponseInferrerId } from "../../constants/core/response-inference.constant.js";

/**
 * The route, as the inferrer sees it.
 *
 * Deliberately narrow: it is the intersection of `ParsedRoute` (what
 * the scanners produce) and `EndpointSpecLike` (what the dispatcher
 * has while enriching a spec). Both are structurally compatible with
 * it, so the same inferrer serves the pipeline and the direct calls.
 */
export interface IResponseRoute {
  /** HTTP method. Uppercase in practice, but not enforced here. */
  readonly method: string;
  /** Full URI, prefixes already applied. */
  readonly uri: string;
  /**
   * The URI **as declared in the source**, without the prefixes the
   * scanner applied.
   *
   * It is the field that lets an inferrer find its route in the file:
   * a route mounted under `/api` is declared as `/users`, and only the
   * raw form appears in the code.
   */
  readonly rawUri?: string;
  /** File the route was declared in, relative to the project root. */
  readonly sourceFile?: string;
  /** 1-based line of the declaration. `0` when unknown. */
  readonly lineNumber?: number;
  /** Framework that produced the route, when the scanner said so. */
  readonly framework?: string;
  /**
   * Controller the route dispatches to, when the scanner resolved it
   * (Laravel: `App\Http\Controllers\UserController`).
   */
  readonly controllerClass?: string;
  /** Action the route dispatches to, when the scanner resolved it. */
  readonly actionName?: string;
}

/**
 * Everything an inferrer may read besides the route itself.
 *
 * The context is passed whole (instead of the source file alone) so a
 * new signal can be added without changing the signature of every
 * inferrer — the same reason the legacy contract received a source
 * file instead of a path.
 */
export interface IResponseInferContext {
  /**
   * Framework slug the route belongs to — the one the dispatcher
   * selected the inferrer with. An inferrer that serves a sub-slice of
   * a framework (Laravel Resources inside Laravel) can use it to tell
   * "the caller says Laravel" from "the route says Laravel".
   */
  readonly framework: string;
  /** The file the route was declared in, with its content. */
  readonly source: IFrameworkSourceFileLike;
  /** The endpoint being enriched, when the caller has one. */
  readonly spec?: EndpointSpecLike;
  /**
   * Reads another file of the same project, by its path relative to
   * the project root.
   *
   * Two of the six frameworks declare their routes in one file and
   * their responses in **another**: Rails declares the routes in
   * `config/routes.rb` and renders the response in
   * `app/controllers/users_controller.rb`; Laravel declares the routes
   * in `routes/api.php` and returns the Resource from
   * `app/Http/Controllers/UserController.php`. An inferrer that needs
   * the second file asks for it here.
   *
   * The resolver is **optional** and the dispatcher owns the I/O: an
   * inferrer stays a pure function of the text it reads, and a caller
   * that has no project on disk (a unit test, a cached snapshot) can
   * leave it out. When it is absent — or when the file does not
   * exist — the answer is `null`, and the inferrer says what it can
   * prove from the route's own file.
   */
  readonly readSource?: (
    relativePath: string,
  ) => IFrameworkSourceFileLike | null;
}

/**
 * What one inferrer concluded about one route.
 *
 * A route can have **more than one** response: the success one plus
 * the error variants (`404`, `409`). Spring's `@ApiResponse` and
 * NestJS' `NotFoundException` both prove it. So the spec is a
 * collection, not a single entry — a contract that could only hold
 * one response would have forced the adapters to drop half of what
 * the legacy inferrers already knew.
 *
 * Never empty: an inferrer with nothing to say returns `null`, not an
 * empty collection.
 */
export interface IResponseSpec {
  /** The responses attributed to the route. At least one. */
  readonly responses: ReadonlyArray<IResponseInference>;
}

/**
 * A response inferrer: one per framework (or per framework slice).
 *
 * Implementations live next to the code they read — the six added in
 * `r00020` S3 are in `packages/core/response-inference/`, the four
 * legacy ones in `packages/frameworks/scanners/`. The registry that
 * composes them is `packages/core/responses/registry.ts`.
 */
export interface IResponseInferrer {
  /**
   * Framework slug this inferrer serves — the value the registry
   * selects it with. It is the **only** discriminator: two inferrers
   * for the same framework cannot coexist (the registry replaces the
   * previous one, it does not stack).
   */
  readonly framework: string;
  /**
   * Can this inferrer say something about this route?
   *
   * The cheap question, asked before any parsing. `false` means
   * "not mine" — either another framework, or a route of my framework
   * that does not use the construct I understand (a Laravel controller
   * that returns a plain array, a Rails action that renders HTML).
   */
  detect(framework: string, route: IResponseRoute): boolean;
  /**
   * What does this route return?
   *
   * Returns the responses it can **prove** from the source, or `null`
   * when it cannot prove any. Never throws by contract: the
   * dispatcher shields every call, and an inferrer that crashes
   * becomes a warning instead of a broken generation.
   */
  infer(route: IResponseRoute, ctx: IResponseInferContext): IResponseSpec | null;
}

/**
 * A route declaration found in a file.
 *
 * The shape every inferrer reads when it has to answer "which part of
 * this file belongs to the route I was given?". It is a **contract**
 * and not an implementation detail because the six inferrers share
 * the arithmetic of finding the declaration — only the *pattern* that
 * recognises it is framework-specific.
 */
export interface IRouteAnchor {
  /** Offset of the match in the source. */
  readonly index: number;
  /** Offset just after the match. */
  readonly end: number;
  /** 0-based line the declaration starts on. */
  readonly line: number;
  /** The HTTP method, uppercased. */
  readonly method: string;
  /** The path as declared, without any prefix. */
  readonly path: string;
}

/**
 * One entry of the registry: the inferrer, the id it is registered
 * under and the framework it is selected with.
 *
 * The id and the framework are **not** the same thing — `laravel-
 * resources` is the id and `laravel` is the framework — so an entry
 * carries both, and the catalog
 * (`constants/core/response-inference.constant.ts`) is what declares
 * the relationship.
 */
export interface IResponseInferrerEntry {
  /** The inferrer's id — the unit the catalog and the coverage speak in. */
  readonly id: ResponseInferrerId;
  /** The framework slug the registry selects this inferrer with. */
  readonly framework: string;
  /** The inferrer itself. */
  readonly inferrer: IResponseInferrer;
}
