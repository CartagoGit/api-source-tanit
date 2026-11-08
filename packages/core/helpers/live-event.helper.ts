import type { LiveEvent } from "../../contracts/interfaces/core/live.interface.js";

/** Validate the shared event envelope at the browser/IPC boundary. */
export function isLiveEvent(value: unknown): value is LiveEvent {
  if (typeof value !== "object" || value === null) return false;
  if (!("subscriptionId" in value) || typeof value.subscriptionId !== "string" ||
      !("sessionId" in value) || typeof value.sessionId !== "string" ||
      !("projectRoot" in value) || typeof value.projectRoot !== "string" ||
      !("type" in value)) return false;
  if (value.type === "session-closed" || value.type === "subscription-closed") return true;
  if (value.type === "snapshot-stale") {
    return "changedPaths" in value && Array.isArray(value.changedPaths) &&
      value.changedPaths.every((path) => typeof path === "string");
  }
  if (value.type !== "snapshot-ready" || !("summary" in value) ||
      typeof value.summary !== "object" || value.summary === null ||
      !("sourceFileCount" in value) || typeof value.sourceFileCount !== "number" ||
      !Number.isInteger(value.sourceFileCount) || value.sourceFileCount < 0) return false;
  const summary = value.summary;
  return "sessionId" in summary && summary.sessionId === value.sessionId &&
    "projectRoot" in summary && summary.projectRoot === value.projectRoot &&
    "capturedAt" in summary && typeof summary.capturedAt === "string" &&
    "endpointCount" in summary && typeof summary.endpointCount === "number" &&
    "serviceCount" in summary && typeof summary.serviceCount === "number" &&
    "frameworks" in summary && Array.isArray(summary.frameworks) &&
    summary.frameworks.every((name) => typeof name === "string") &&
    "diagnostics" in summary && Array.isArray(summary.diagnostics);
}
