import { describe, expect, test } from "vitest";
import { isLiveEvent, isLiveOutputChange } from "../../packages/core/helpers/live-event.helper.js";

describe("live event boundaries", () => {
  test("validates rescan failures as the same typed carrier payload", () => {
    const error = { type: "snapshot-error", projectRoot: "/api", sessionId: "s", subscriptionId: "a",
      message: "Source read failed", changedPaths: ["src/routes.ts"] };
    expect(isLiveEvent(error)).toBe(true);
    expect(isLiveEvent({ ...error, message: 5 })).toBe(false);
    expect(isLiveEvent({ ...error, changedPaths: [5] })).toBe(false);
  });
  test("rejects malformed or mismatched summaries", () => {
    expect(isLiveEvent(null)).toBe(false);
    expect(isLiveEvent({ type: "snapshot-stale", projectRoot: "/api", sessionId: "s", subscriptionId: "a", changedPaths: [3] })).toBe(false);
    expect(isLiveEvent({ type: "snapshot-ready", projectRoot: "/api", sessionId: "s", subscriptionId: "a",
      sourceFileCount: 1, changedPaths: [], summary: { projectRoot: "/other", sessionId: "s", frameworks: [],
        capturedAt: "now", endpointCount: 1, serviceCount: 1, diagnostics: [] } })).toBe(false);
  });
});

describe("export feedback protection", () => {
  test("ignores actual artifacts, their temporary siblings and directory creation", () => {
    const files = ["/api/tanit/schema.json"];
    expect(isLiveOutputChange("tanit/schema.json", "/api", files)).toBe(true);
    expect(isLiveOutputChange("tanit/.123-1.tmp", "/api", files)).toBe(true);
    expect(isLiveOutputChange("tanit", "/api", files)).toBe(true);
    expect(isLiveOutputChange("src/routes.ts", "/api", files)).toBe(false);
    expect(isLiveOutputChange(".", "/api", files)).toBe(false);
  });
  test("supports a relative project root and an absolute written destination", () => {
    const files = ["/checkout/api/tanit/schema.json"];
    expect(isLiveOutputChange("tanit/schema.json", "api", files)).toBe(true);
    expect(isLiveOutputChange("tanit/.123-1.tmp", "api", files)).toBe(true);
    expect(isLiveOutputChange("src/routes.ts", "api", files)).toBe(false);
  });
  test("preserves real source changes beside a custom output file", () => {
    expect(isLiveOutputChange("src/routes.ts", "/api", ["/api/src/schema.json"])).toBe(false);
    expect(isLiveOutputChange("src/schema.json", "/api", ["/api/src/schema.json"])).toBe(true);
  });
  test("accepts Windows path separators", () => {
    expect(isLiveOutputChange("tanit\\schema.json", "C:\\api", ["C:\\api\\tanit\\schema.json"])).toBe(true);
  });
});
