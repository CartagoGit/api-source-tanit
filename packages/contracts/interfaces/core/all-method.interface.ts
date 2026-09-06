/**
 * Type for the `ALL`-expansion helper.
 *
 * Lives here — not in `packages/core/helpers/` — because every
 * exporter's `IExportInput.specs` field can carry `IExpandedSpec`
 * entries. Putting the type next to the helper that produces it
 * would drag the helper into every exporter module; `lint:contracts`
 * enforces the split.
 */
import type { EndpointSpec } from "./postman.interface.js";

/** A spec paired with an optional marker if it came from an `ALL` expansion. */
export interface IExpandedSpec {
  readonly spec: EndpointSpec;
  /** Present iff the spec was produced by an `ALL` expansion. */
  readonly allMarker?: "hono.all";
}
