/**
 * The legacy response inferrers, adapted to the agnostic contract
 * (proposal `r00020` S3).
 *
 * ## Why this file exists
 *
 * The coverage baseline of the four legacy inferrers is measured in
 * `tests/response-inference/coverage.spec.ts`, and that spec belongs
 * to the **core** section: it may not import `packages/frameworks/`
 * (`lint:boundaries` — the core is the part of the product that does
 * not know about frameworks). The NestJS inferrer lives there,
 * because it reads NestJS source and has always lived next to the
 * NestJS scanner.
 *
 * `tests/helpers/` is the transversal folder — it belongs to no
 * section on purpose, and it already carries the doubles that reach
 * the scanners (`run-scanner.ts`, `scanner-fixture.ts`,
 * `scanner-contract.ts`). This helper is the same kind of double: it
 * hands the coverage spec the legacy NestJS inferrer **already
 * adapted** to the agnostic contract, so the spec measures it exactly
 * like the six core ones.
 *
 * ## What is measured is what runs
 *
 * The adaptation is the product's own (`adaptLegacyResponseInferrer`),
 * not a test-only imitation: the baseline the spec pins is the
 * baseline of the inferrer the dispatcher runs in production.
 *
 * ## One side effect, on purpose
 *
 * Importing the NestJS inferrer **registers** it in the live registry
 * (`packages/frameworks/scanners/nestjs.response-inferrer.ts` does it
 * at module load). That is the production behaviour, and the coverage
 * spec does not look at the registry — but a future spec in the same
 * file that counts the registry entries has to know that the NestJS
 * one is in there.
 */
import { adaptLegacyResponseInferrer } from "../../packages/core/responses/registry.js";
import { NestJsResponseInferrer } from "../../packages/frameworks/scanners/nestjs.response-inferrer.js";
import type { IResponseInferrer } from "../../packages/contracts/interfaces/core/response-inferrer.interface.js";

/**
 * The legacy NestJS inferrer, in the agnostic contract.
 *
 * The baseline `nestjs: 100` is measured over this instance — the
 * same one the dispatcher runs.
 */
export const nestjsResponseInferrer: IResponseInferrer =
  adaptLegacyResponseInferrer(new NestJsResponseInferrer());
