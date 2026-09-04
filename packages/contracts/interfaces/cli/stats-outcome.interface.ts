/**
 * What collection statistics return.
 *
 * Lives here, not inside `stats.script.ts`, for the same reason as
 * `IScanOutcome`: it is consumed by the command that produces it
 * and the MCP tool that exposes it, and neither should have to
 * import the other to know the shape of the data.
 *
 * The breakdowns have an invariant the type cannot express but the
 * tests do check: `total` is the sum of `byMethod`, and also of
 * `zones`; each zone's `total` is the sum of its `byFolder`. A
 * breakdown whose sub-counts do not add up to its own total is the
 * kind of number people make decisions on without knowing it.
 */

/** How many requests there are for an HTTP method. */
export interface IMethodCount {
  readonly method: string;
  readonly count: number;
}

/** How many requests hang off a top-level folder. */
export interface IFolderCount {
  readonly folder: string;
  readonly count: number;
}

/** Breakdown of one zone. Only zones with content appear. */
export interface IZoneStats {
  readonly zone: string;
  readonly total: number;
  readonly byFolder: ReadonlyArray<IFolderCount>;
}

/** Full result of counting a collection. */
export interface IStatsOutcome {
  readonly code: number;
  readonly total: number;
  /** Highest first, as printed. */
  readonly byMethod: ReadonlyArray<IMethodCount>;
  /** In the display order dictated by zone configuration. */
  readonly zones: ReadonlyArray<IZoneStats>;
}
