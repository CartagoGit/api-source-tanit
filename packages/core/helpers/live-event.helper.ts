import { SnapshotSummarySchema } from "../../contracts/constants/core/application-api.constant.js";
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
  if (!("changedPaths" in value) || !Array.isArray(value.changedPaths) ||
      !value.changedPaths.every((path) => typeof path === "string")) return false;
  const parsed = SnapshotSummarySchema.safeParse(value.summary);
  return parsed.success && parsed.data.sessionId === value.sessionId &&
    parsed.data.projectRoot === value.projectRoot;
}

/** Identify writes to already generated artifacts without ignoring source changes. */
export function isLiveOutputChange(path: string, projectRoot: string, outputs: readonly string[]): boolean {
  const root = normalizePath(projectRoot);
  const changed = normalizePath(isAbsolute(path) ? path : `${root}/${path}`);
  if (changed === root) return false;
  return outputs.some((output) => {
    const rooted = output.replace(/\\/g, "/").startsWith(`${root}/`);
    const target = normalizePath(isAbsolute(output) || rooted ? output : `${root}/${output}`);
    const matches = (candidate: string) => target === candidate || target.startsWith(`${candidate}/`) ||
      (!isAbsolute(candidate) && (target.endsWith(`/${candidate}`) || target.includes(`/${candidate}/`)));
    if (matches(changed)) return true;
    // Atomic writers create transient files beside their destination.
    const directory = changed.slice(0, changed.lastIndexOf("/"));
    const targetDirectory = target.slice(0, target.lastIndexOf("/"));
    return changed.endsWith(".tmp") && (targetDirectory === directory ||
      (!isAbsolute(directory) && targetDirectory.endsWith(`/${directory}`)));
  });
}

function isAbsolute(path: string): boolean { return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(path); }
function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + parts.join("/");
}
