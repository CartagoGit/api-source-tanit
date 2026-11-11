import type { z } from "zod";
import type {
  ContractScanEvidenceSchema, ContractSourceSchema, ContractOperationEvidenceSchema,
  ContractComparisonSchema, ContractEvidenceReportSchema,
} from "../../constants/core/contract-evidence.constant.js";
import type { EndpointSpec } from "./endpoint-legacy.interface.js";
import type { ParsedRoute } from "./scanner.interface.js";

export type IContractScanEvidence = z.infer<typeof ContractScanEvidenceSchema>;
export type IContractSource = z.infer<typeof ContractSourceSchema>;
export type IContractOperationEvidence = z.infer<typeof ContractOperationEvidenceSchema>;
export type IContractComparison = z.infer<typeof ContractComparisonSchema>;
export type IContractEvidenceReport = z.infer<typeof ContractEvidenceReportSchema>;

/** Raw scanner facts, before the existing merger chooses an effective value. */
export interface IContractScan {
  readonly source: IContractSource;
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
}
