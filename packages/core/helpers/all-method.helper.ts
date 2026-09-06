/**
 * Expands `EndpointSpec.method === "ALL"` (the Hono `.all()` sentinel
 * emitted by commit `aad6376`, audited again on 2026-09-06 §13) into
 * the seven standard HTTP verbs that every exporter except Postman
 * can represent directly.
 *
 * Postman keeps the original `ALL` and translates it to `ANY` at the
 * request-build level (`postmanMethodFor` in `collection-builder.
 * service`). The four other exporters — OpenAPI, HAR, Bruno,
 * Insomnia — have no equivalent verb, so we materialise one entry
 * per verb here.
 *
 * The marker travels with the expansion: OpenAPI turns it into an
 * extension on the operation object; the other formats have nowhere
 * to attach metadata and ignore it. The marker is the only way the
 * user (or a downstream tool) can tell that the seven operations
 * came from a single `app.all('/x', h)` and weren't declared
 * individually.
 *
 * Keeping the expansion in a single helper — instead of four
 * independent loops in each exporter — means the rule "ALL → seven
 * verbs" lives in one place and is testable in isolation.
 *
 * The marker constant and the seven verbs live in
 * `packages/contracts/`: every exporter module imports them, so
 * they belong to the public contract rather than this helper.
 * `lint:contracts` enforces the split.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { IExpandedSpec } from "../../contracts/interfaces/core/all-method.interface.js";
import {
  ALL_METHOD_MARKER,
  ALL_METHOD_VERBS,
} from "../../contracts/constants/core/all-method.constant.js";

export { ALL_METHOD_MARKER, ALL_METHOD_VERBS };
export type { IExpandedSpec };

/**
 * Returns true iff the spec's method is the `ALL` sentinel.
 *
 * Pulled out as a named predicate so each exporter can decide whether
 * to expand (`true`) or to translate (`false`, Postman). Keeping the
 * `===` check here means adding a future sentinel is a single-file
 * change.
 */
export function isAllMethodSpec(spec: EndpointSpec): boolean {
  return spec.method === "ALL";
}

/**
 * Expands every `method: "ALL"` spec into seven specs with the seven
 * standard verbs. Non-`ALL` specs pass through unchanged.
 *
 * The expansion is shallow: `spec.fields`, `spec.body`, `spec.query`,
 * `spec.headers`, `spec.description`, `spec.schemaGraph` and friends
 * are carried over verbatim. `spec.method` is the only field that
 * changes; `spec.name` and `spec.uri` are preserved so that the
 * seven operations belong to the same endpoint and can be grouped
 * together by downstream tooling.
 */
export function expandAllMethods(
  specs: ReadonlyArray<EndpointSpec>,
): IExpandedSpec[] {
  const out: IExpandedSpec[] = [];
  for (const spec of specs) {
    if (!isAllMethodSpec(spec)) {
      out.push({ spec });
      continue;
    }
    for (const verb of ALL_METHOD_VERBS) {
      out.push({ spec: { ...spec, method: verb }, allMarker: ALL_METHOD_MARKER });
    }
  }
  return out;
}
