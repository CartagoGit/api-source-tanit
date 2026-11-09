export type ChangedCoverageStatus = "PASS" | "NOT_APPLICABLE" | "BELOW_FLOOR" | "FAIL";

export interface IChangedCoverageResult {
  readonly status: ChangedCoverageStatus;
  readonly failures: readonly string[];
}

