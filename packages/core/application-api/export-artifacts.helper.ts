/** Application API adapters for the shared export preparation and writer. */
import * as files from "../exporters/export-files.service.js";
import { apiError } from "./error.js";

/** Translate a domain preparation failure into the API's serializable envelope. */
function apiFailure(error: unknown): unknown {
  return error instanceof files.ExportPreparationError
    ? apiError(error.code, error.message)
    : error;
}

/** Preview the shared plan, with API error semantics. */
export async function planExport(...args: Parameters<typeof files.planExport>): ReturnType<typeof files.planExport> {
  try {
    return await files.planExport(...args);
  } catch (error) {
    throw apiFailure(error);
  }
}

/** Write shared prepared artifacts, with API error semantics. */
export async function writeExport(...args: Parameters<typeof files.writeExport>): ReturnType<typeof files.writeExport> {
  try {
    return await files.writeExport(...args);
  } catch (error) {
    throw apiFailure(error);
  }
}

/** Build once and return both preview and writes, with API error semantics. */
export async function writeExportWithPlan(...args: Parameters<typeof files.writeExportWithPlan>): ReturnType<typeof files.writeExportWithPlan> {
  try {
    return await files.writeExportWithPlan(...args);
  } catch (error) {
    throw apiFailure(error);
  }
}

/** Resolve a caller's destination using the shared export rules. */
export function resolveExportDestination(...args: Parameters<typeof files.resolveExportDestination>): ReturnType<typeof files.resolveExportDestination> {
  try {
    return files.resolveExportDestination(...args);
  } catch (error) {
    throw apiFailure(error);
  }
}
