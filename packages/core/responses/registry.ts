/**
 * Response-inference registry (proposal `r00020` S3).
 *
 * ## What this module is
 *
 * The **single place** that knows which inferrers exist. The
 * dispatcher (`infer-responses.ts`) asks it which inferrer serves a
 * framework; the coverage reporter asks it what is registered; the
 * tests ask it whether the catalog and the registry still agree.
 *
 * ## Where the entries come from
 *
 * Two sources, and the split is not arbitrary:
 *
 * - The **six** inferrers added in this slice live in
 *   `packages/core/response-inference/`, next to the core. They are
 *   imported here **statically**, because the core must never import
 *   from `frameworks/` (`lint:boundaries`) and the core cannot know
 *   about a framework it does not implement.
 * - The **four** legacy inferrers (Spring, NestJS, FastAPI,
 *   ASP.NET) live in `packages/frameworks/scanners/`, next to the
 *   scanners that feed them. The core cannot import them — the edge
 *   has to point the other way. So the frameworks side registers
 *   them here, through `registerResponseInferrer()`, and the registry
 *   adapts their legacy shape to the agnostic contract.
 *
 * That is why `listResponseInferrerEntries()` can return **ten**
 * entries in production and **six** in a test that never imported
 * the frameworks barrel. The catalog (`RESPONSE_INFERRER_IDS`) is the
 * contract; the registry is what fulfills it — and a test compares
 * the two so neither can drift.
 *
 * ## Every entry passes through the same door
 *
 * Registration is the only way into the registry, and registration
 * checks that the inferrer's `framework` is the one the catalog
 * declares for its id. That check used to cover the four legacy
 * inferrers only: the six core ones were written as a literal array
 * of entries and never met it.
 *
 * Now the core six are registered the same way — through factories,
 * at module load — so the catalog and the implementations are checked
 * for all **ten**. An inferrer that declares the wrong framework
 * fails at load time instead of sitting in the registry where nobody
 * would ever select it.
 *
 * ## One inferrer per framework
 *
 * The registry is keyed by framework slug. A second inferrer for the
 * same framework **replaces** the first: stacking two inferrers for
 * Spring would make the result depend on import order, which is not
 * a property anyone can reason about.
 */
import type {
  IResponseInferrer,
  IResponseInferrerEntry,
} from "../../contracts/interfaces/core/response-inferrer.interface.js";
import type {
  ILegacyResponseInferrer,
  IResponseInference,
} from "../../contracts/interfaces/core/responses.interface.js";
import {
  RESPONSE_INFERRER_FRAMEWORKS,
  RESPONSE_INFERRER_IDS,
  type ResponseInferrerId,
} from "../../contracts/constants/core/response-inference.constant.js";

import { FastifyResponseInferrer } from "../response-inference/fastify.helper.js";
import { ExpressResponseInferrer } from "../response-inference/express.helper.js";
import { GinResponseInferrer } from "../response-inference/gin.helper.js";
import { KtorRespondResponseInferrer } from "../response-inference/ktor-respond.helper.js";
import { LaravelResourcesResponseInferrer } from "../response-inference/laravel-resources.helper.js";
import { RailsRenderResponseInferrer } from "../response-inference/rails-render.helper.js";

/**
 * The inferrers the core ships — as **factories**, not as entries.
 *
 * A factory, not an instance, because an instance has to be
 * *registered* to be part of the registry, and registration is what
 * validates it: `registerResponseInferrer` refuses an inferrer whose
 * `framework` disagrees with the catalog. A literal array of entries
 * bypassed that door — the six core inferrers were checked by
 * nobody, and a helper that declared the wrong framework compiled,
 * loaded and sat in the registry undetected.
 *
 * The order is the order they were added, and a test can assert the
 * exact set without depending on a hash order.
 */
const CORE_INFERRER_FACTORIES: ReadonlyArray<
  readonly [ResponseInferrerId, () => IResponseInferrer]
> = [
  ["fastify", () => new FastifyResponseInferrer()],
  ["express", () => new ExpressResponseInferrer()],
  ["laravel-resources", () => new LaravelResourcesResponseInferrer()],
  ["gin", () => new GinResponseInferrer()],
  ["rails-render", () => new RailsRenderResponseInferrer()],
  ["ktor-respond", () => new KtorRespondResponseInferrer()],
];

/** Framework slug → inferrer id. Derived from the catalog, never hand-written. */
const ID_BY_FRAMEWORK: ReadonlyMap<string, ResponseInferrerId> = new Map(
  RESPONSE_INFERRER_IDS.map((id) => [RESPONSE_INFERRER_FRAMEWORKS[id], id]),
);

/**
 * The live registry.
 *
 * Mutable on purpose — it is the composition point of the feature —
 * but every read goes through a function that returns a frozen copy.
 *
 * It starts **empty**: the core inferrers are registered below, through
 * the same door the frameworks side uses, so the catalog and the
 * implementations are checked for all ten entries and not only for
 * the four legacy ones.
 */
let entries: IResponseInferrerEntry[] = [];

/**
 * Registers an inferrer under its id.
 *
 * Replaces any entry with the same id **or** the same framework: one
 * framework, one inferrer. The framework of the inferrer must match
 * the one the catalog declares for that id — a mismatch means the
 * catalog and the implementation drifted, and it fails loudly here
 * instead of silently never being selected.
 */
export function registerResponseInferrer(
  id: ResponseInferrerId,
  inferrer: IResponseInferrer,
): void {
  const expected = RESPONSE_INFERRER_FRAMEWORKS[id];
  if (inferrer.framework !== expected) {
    throw new Error(
      `response-inference: inferrer "${id}" declares framework ` +
        `"${inferrer.framework}" but the catalog says "${expected}".`,
    );
  }
  entries = entries.filter(
    (e) => e.id !== id && e.framework !== inferrer.framework,
  );
  entries.push({ id, framework: inferrer.framework, inferrer });
}

/**
 * Registers the inferrers the core ships.
 *
 * They go through `registerResponseInferrer` — the same door the
 * frameworks side uses — so the agreement between the catalog and the
 * implementations is checked for the core six too. A helper that
 * declares the wrong framework now fails **at load time**, loudly,
 * instead of sitting in the registry where nobody would ever select
 * it.
 */
function registerCoreInferrers(): void {
  for (const [id, factory] of CORE_INFERRER_FACTORIES) {
    registerResponseInferrer(id, factory());
  }
}

/* The bootstrap: the core six are part of the registry from the start. */
registerCoreInferrers();

/**
 * The entries currently registered, in registration order.
 *
 * Frozen copy: a caller cannot mutate the registry by holding on to
 * the array.
 */
export function listResponseInferrerEntries(): ReadonlyArray<IResponseInferrerEntry> {
  return Object.freeze([...entries]);
}

/**
 * The inferrers currently registered, in registration order.
 */
export function listResponseInferrers(): ReadonlyArray<IResponseInferrer> {
  return Object.freeze(entries.map((e) => e.inferrer));
}

/**
 * The inferrer that serves `framework`, or `null` when none does.
 *
 * This is the entry point of the whole feature: the dispatcher asks
 * it, and the answer is either an inferrer or "nobody knows how this
 * framework answers" — which is a normal state, not an error.
 */
export function selectInferrer(framework: string): IResponseInferrer | null {
  const found = entries.find((e) => e.framework === framework);
  return found ? found.inferrer : null;
}

/**
 * The entry that serves `framework`, or `null`.
 *
 * Same lookup as `selectInferrer`, but it also answers *which*
 * inferrer it is — what the coverage reporter needs to attribute a
 * percentage to an id.
 */
export function selectInferrerEntry(
  framework: string,
): IResponseInferrerEntry | null {
  return entries.find((e) => e.framework === framework) ?? null;
}

/**
 * The id of the inferrer that serves `framework`, or `null`.
 */
export function inferrerIdForFramework(framework: string): ResponseInferrerId | null {
  return ID_BY_FRAMEWORK.get(framework) ?? null;
}

/**
 * Replaces the whole registry — test-only escape hatch.
 *
 * Tests that need a specific inferrer (or none at all) seed the
 * registry here instead of reaching into the module's internals. The
 * list may contain two inferrers for the same framework on purpose:
 * that is how the dispatcher is tested against a registry that was
 * assembled by hand.
 */
export function __setResponseInferrersForTest(
  list: ReadonlyArray<IResponseInferrerEntry>,
): void {
  entries = [...list];
}

/**
 * Restores the registry to the state production has — the six core
 * inferrers and nothing else. Test-only counterpart of
 * `__setResponseInferrersForTest`.
 *
 * They are registered again, through the same door, so the reset
 * cannot hand back a registry the production code would refuse.
 */
export function __resetResponseInferrersForTest(): void {
  entries = [];
  registerCoreInferrers();
}

/**
 * Wraps a legacy inferrer in the agnostic contract.
 *
 * The four inferrers that predate this slice implement
 * `ILegacyResponseInferrer`: they take an endpoint projection plus a
 * source file and return a list of entries. The agnostic contract
 * takes a route plus a context and returns a spec or `null`.
 *
 * The adapter is the whole translation:
 *
 * - the route **is** the endpoint projection (both carry method, uri,
 *   source file and line);
 * - the context's source **is** the source file;
 * - a list becomes a spec, and an empty list becomes `null` — which is
 *   what the new contract means by "no signal".
 *
 * Nothing about the legacy behaviour changes: the same code runs, over
 * the same input, with the same result.
 */
export function adaptLegacyResponseInferrer(
  legacy: ILegacyResponseInferrer,
): IResponseInferrer {
  return {
    framework: legacy.framework,
    detect: (framework: string) => framework === legacy.framework,
    infer: (route, ctx): { responses: ReadonlyArray<IResponseInference> } | null => {
      const produced = legacy.infer(route, ctx.source);
      return produced.length > 0 ? { responses: produced } : null;
    },
  };
}
