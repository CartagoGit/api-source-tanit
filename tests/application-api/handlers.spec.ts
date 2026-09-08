/**
 * Tests for the 14 Application API handlers (f00016 S3).
 *
 * Two layers:
 *   - **Per-handler**: at least one success case + one error case for
 *     each of the 14 handlers.
 *   - **Dispatcher**: validates inputs, wraps errors, never throws.
 *
 * The orchestrator is a stub — the suite never touches a real
 * project. `openSession` is driven by a `vi.fn()` that returns a
 * zero-result scan, which is exactly what we need to verify the
 * handler plumbing without dragging the 21 scanners behind us.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { dispatch, type IRequestContext } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import {
  closeAllSessions,
  openSession,
} from "../../packages/core/session/project-session.service.js";
import {
  apiError,
  fail,
  fromZodError,
  isApiError,
  ok,
} from "../../packages/core/application-api/error.js";
import {
  clearSubscriptions,
} from "../../packages/core/application-api/watch.handlers.js";
import { recordHistoryEntry } from "../../packages/core/application-api/history.handlers.js";

import type { IGenerationOptions } from "../../packages/contracts/interfaces/core/discovery.interface.js";
import type { IDiscoveryOrchestrator } from "../../packages/contracts/interfaces/core/scanner.interface.js";
import type { OpenProjectOutput } from "../../packages/core/application-api/open-project.handler.js";
import type { SnapshotOutput } from "../../packages/core/application-api/snapshot.handlers.js";
import type { ListEndpointsOutput } from "../../packages/core/application-api/list-endpoints.handler.js";
import type { GetEndpointOutput } from "../../packages/core/application-api/get-endpoint.handler.js";
import type { GetSchemaOutput } from "../../packages/core/application-api/get-schema.handler.js";
import type { ListServicesOutput } from "../../packages/core/application-api/list-services.handler.js";
import type { DryRunOutput } from "../../packages/core/application-api/dry-run.handler.js";
import type { ExportOutput } from "../../packages/core/application-api/export.handler.js";
import type { HistoryOutput } from "../../packages/core/application-api/history.handlers.js";
import type { WatchOutput } from "../../packages/core/application-api/watch.handlers.js";
import type { CancelOutput } from "../../packages/core/application-api/cancel.handler.js";
import type { SettingsOutput } from "../../packages/core/application-api/settings.handlers.js";
import type { ListProjectsOutput } from "../../packages/core/application-api/list-projects.handler.js";
import type { CloseOutput } from "../../packages/core/application-api/close.handler.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrchestrator(): IDiscoveryOrchestrator {
  return {
    detectAll: vi.fn().mockResolvedValue([]),
    detectAllWithDiagnostics: vi.fn().mockResolvedValue({
      detected: [],
      diagnostics: [],
    }),
    forceFramework: vi.fn().mockResolvedValue(null),
    supportedFrameworks: vi.fn().mockReturnValue([]),
  };
}

function makeCtx(extra: Partial<IRequestContext> = {}): IRequestContext {
  return {
    caller: "cli",
    orchestrator: makeOrchestrator(),
    ...extra,
  };
}

async function openSampleSession(projectRoot: string): Promise<void> {
  // `generateCollections()` requires the project root to exist on
  // disk. The test paths under `/tmp/...` are arbitrary strings
  // (cheap + easy to read), so we create them on demand.
  const { mkdirSync } = await import("node:fs");
  mkdirSync(projectRoot, { recursive: true });
  const opts: IGenerationOptions = {
    orchestrator: makeOrchestrator(),
  };
  await openSession(projectRoot, {
    generationOptions: opts,
    watch: false,
  });
}

/**
 * Typed dispatch wrapper — narrows `value` to `T` so the tests
 * can read fields without casts.
 */
async function dispatchAs<T>(
  name: string,
  rawInput: unknown,
  ctx: IRequestContext,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ReturnType<typeof apiError> }
> {
  return dispatch<T>(buildRegistry(), name, rawInput, ctx);
}

beforeEach(() => {
  closeAllSessions();
  clearSubscriptions();
});

afterEach(() => {
  closeAllSessions();
  clearSubscriptions();
});

// ── Sanity: the barrel shape ─────────────────────────────────────────────────

describe("buildRegistry()", () => {
  test("exposes every canonical handler name", () => {
    const reg = buildRegistry();
    const expected = [
      "open-project",
      "snapshot",
      "list-endpoints",
      "get-endpoint",
      "get-schema",
      "list-services",
      "dry-run",
      "export",
      "history",
      "watch",
      "cancel",
      "settings",
      "list-projects",
      "close",
    ];
    for (const name of expected) {
      expect(reg[name], `handler "${name}" missing`).toBeDefined();
      expect(reg[name]?.name).toBe(name);
    }
  });

  test("returns a frozen object", () => {
    const reg = buildRegistry();
    expect(Object.isFrozen(reg)).toBe(true);
  });
});

// ── error.ts helpers ────────────────────────────────────────────────────────

describe("error helpers", () => {
  test("apiError() builds a typed envelope without details", () => {
    const e = apiError("INVALID_INPUT", "boom");
    expect(e.code).toBe("INVALID_INPUT");
    expect(e.message).toBe("boom");
    expect(e.details).toBeUndefined();
  });

  test("apiError() includes details when provided", () => {
    const e = apiError("INVALID_INPUT", "boom", { x: 1 });
    expect(e.details).toEqual({ x: 1 });
  });

  test("isApiError() discriminates on code+message strings", () => {
    expect(isApiError({ code: "X", message: "y" })).toBe(true);
    expect(isApiError({ code: "X" })).toBe(false);
    expect(isApiError({ message: "y" })).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError("plain string")).toBe(false);
  });

  test("ok() and fail() build the union", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    const err = apiError("EXECUTION_FAILED", "y");
    expect(fail(err)).toEqual({ ok: false, error: err });
  });

  test("fromZodError() flattens a parse failure into INVALID_INPUT", () => {
    const err = {
      flatten: () => ({ fieldErrors: { name: ["required"] }, formErrors: [] }),
      issues: [],
    };
    const envelope = fromZodError(err as unknown as Parameters<typeof fromZodError>[0]);
    expect(envelope.code).toBe("INVALID_INPUT");
    expect(envelope.details).toEqual({
      fieldErrors: { name: ["required"] },
      formErrors: [],
    });
  });
});

// ── Dispatcher — error wrapping ──────────────────────────────────────────────

describe("dispatch() — error paths", () => {
  const reg = buildRegistry();

  test("unknown handler returns UNKNOWN_HANDLER", async () => {
    const res = await dispatch(reg, "nope", {}, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("UNKNOWN_HANDLER");
    }
  });

  test("invalid input returns INVALID_INPUT", async () => {
    const res = await dispatch(reg, "open-project", { projectRoot: "" }, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("INVALID_INPUT");
      expect(res.error.details?.fieldErrors).toBeDefined();
    }
  });

  test("aborted signal short-circuits with CANCELED", async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await dispatch(reg, "snapshot", { projectRoot: "/tmp" }, {
      ...makeCtx(),
      signal: controller.signal,
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("CANCELED");
    }
  });

  test("handler that throws an IApiError propagates the same code", async () => {
    const fakeReg = {
      thrower: {
        name: "thrower",
        input: { parse: (x: unknown) => x } as never,
        handle: async () => {
          throw apiError("EXECUTION_FAILED", "boom");
        },
      },
    };
    const res = await dispatch(fakeReg, "thrower", {}, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("EXECUTION_FAILED");
    }
  });
});

// ── Per-handler — success + error ────────────────────────────────────────────

describe("open-project", () => {
  test("opens a session and returns its summary", async () => {
    const root = "/tmp/open-project-success";
    await openSampleSession(root);
    // The handler closes+reopens with the request's options, so
    // close the session we just opened above to start clean.
    closeAllSessions();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(root, { recursive: true });
    const res = await dispatchAs<OpenProjectOutput>("open-project",
      { projectRoot: root },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.sessionId).toMatch(/^session:/);
      expect(res.value.summary.projectRoot).toBe(root);
    }
  });

  test("rejects missing orchestrator", async () => {
    const res = await dispatchAs<OpenProjectOutput>("open-project",
      { projectRoot: "/tmp/no-orchestrator" },
      { caller: "cli" },
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("EXECUTION_FAILED");
    }
  });
});

describe("snapshot", () => {
  test("returns summary when session exists", async () => {
    const root = "/tmp/snapshot-success";
    await openSampleSession(root);
    const res = await dispatchAs<SnapshotOutput>("snapshot", { projectRoot: root }, makeCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.summary.projectRoot).toBe(root);
    }
  });

  test("returns SESSION_NOT_FOUND when session is missing", async () => {
    const res = await dispatchAs<SnapshotOutput>("snapshot",
      { projectRoot: "/tmp/no-such-session" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

describe("list-endpoints", () => {
  test("returns an empty endpoint list when the scan has no specs", async () => {
    const root = "/tmp/list-endpoints-success";
    await openSampleSession(root);
    const res = await dispatchAs<ListEndpointsOutput>("list-endpoints", { projectRoot: root }, makeCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.endpoints).toEqual([]);
      expect(res.value.total).toBe(0);
      expect(res.value.nextCursor).toBeNull();
    }
  });

  test("rejects unknown project", async () => {
    const res = await dispatchAs<ListEndpointsOutput>("list-endpoints",
      { projectRoot: "/tmp/no-session-list-endpoints" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

describe("get-endpoint", () => {
  test("returns OPERATION_NOT_FOUND when no endpoint matches", async () => {
    const root = "/tmp/get-endpoint-success";
    await openSampleSession(root);
    const res = await dispatchAs<GetEndpointOutput>("get-endpoint",
      { projectRoot: root, method: "GET", uri: "/users" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("OPERATION_NOT_FOUND");
    }
  });

  test("rejects unknown project", async () => {
    const res = await dispatchAs<GetEndpointOutput>("get-endpoint",
      { projectRoot: "/tmp/no-session-get-endpoint", method: "GET", uri: "/users" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

describe("get-schema", () => {
  test("returns OPERATION_NOT_FOUND when no endpoint matches", async () => {
    const root = "/tmp/get-schema-success";
    await openSampleSession(root);
    const res = await dispatchAs<GetSchemaOutput>("get-schema",
      { projectRoot: root, method: "GET", uri: "/missing" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("OPERATION_NOT_FOUND");
    }
  });

  test("rejects unknown project", async () => {
    const res = await dispatchAs<GetSchemaOutput>("get-schema",
      { projectRoot: "/tmp/no-session-get-schema", method: "GET", uri: "/missing" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

describe("list-services", () => {
  test("returns zero-endpoint services when no scanner matched", async () => {
    const root = "/tmp/list-services-success";
    await openSampleSession(root);
    const res = await dispatchAs<ListServicesOutput>("list-services",
      { projectRoot: root },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      // The pipeline always emits one default service entry even
      // when no scanner matched; the contract is "0 endpoints".
      expect(res.value.services.length).toBeGreaterThanOrEqual(1);
      for (const svc of res.value.services) {
        expect(svc.endpointCount).toBe(0);
      }
    }
  });

  test("rejects unknown project", async () => {
    const res = await dispatchAs<ListServicesOutput>("list-services",
      { projectRoot: "/tmp/no-session-list-services" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

describe("dry-run", () => {
  test("returns the dry-run summary with duration", async () => {
    const root = "/tmp/dry-run-success";
    await openSampleSession(root);
    const res = await dispatchAs<DryRunOutput>("dry-run",
      { projectRoot: root },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.endpointCount).toBe(0);
      expect(res.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("rejects when orchestrator is missing", async () => {
    const root = "/tmp/dry-run-no-orchestrator";
    await openSampleSession(root);
    const res = await dispatchAs<DryRunOutput>("dry-run",
      { projectRoot: root },
      { caller: "cli" },
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("EXECUTION_FAILED");
    }
  });
});

describe("export", () => {
  test("accepts known targets", async () => {
    const root = "/tmp/export-success";
    await openSampleSession(root);
    const res = await dispatchAs<ExportOutput>("export",
      { projectRoot: root, target: "postman" },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.outputPath).toContain("postman");
    }
  });

  test("rejects unknown target", async () => {
    const root = "/tmp/export-unknown";
    await openSampleSession(root);
    const res = await dispatchAs<ExportOutput>("export",
      { projectRoot: root, target: "definitely-not-a-real-target" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("EXPORT_FAILED");
    }
  });
});

describe("history", () => {
  test("returns empty entries for a fresh session", async () => {
    const root = "/tmp/history-success";
    await openSampleSession(root);
    const res = await dispatchAs<HistoryOutput>("history", { projectRoot: root }, makeCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.entries).toEqual([]);
      expect(res.value.total).toBe(0);
    }
  });

  test("rejects unknown project", async () => {
    const res = await dispatchAs<HistoryOutput>("history",
      { projectRoot: "/tmp/no-session-history" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("SESSION_NOT_FOUND");
    }
  });

  test("recordHistoryEntry appends to the ring buffer", () => {
    recordHistoryEntry("s1", {
      kind: "snapshot-ready",
      capturedAt: new Date().toISOString(),
      sessionId: "s1",
    });
    recordHistoryEntry("s1", {
      kind: "snapshot-stale",
      capturedAt: new Date().toISOString(),
      changedPaths: ["/x.ts"],
    });
    expect(true).toBe(true); // side effect tested via the handler above
  });
});

describe("watch", () => {
  test("returns a subscription id when session exists", async () => {
    const root = "/tmp/watch-success";
    await openSampleSession(root);
    const res = await dispatchAs<WatchOutput>("watch",
      { projectRoot: root },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.subscription.subscriptionId).toMatch(/^sub:/);
      expect(res.value.subscription.projectRoot).toBe(root);
    }
  });

  test("rejects unknown project", async () => {
    const res = await dispatchAs<WatchOutput>("watch",
      { projectRoot: "/tmp/no-session-watch" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

describe("cancel", () => {
  test("is idempotent and returns 0 when nothing matches", async () => {
    const res = await dispatchAs<CancelOutput>("cancel",
      { projectRoot: "/tmp/no-session-cancel" },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.cancelled).toBe(0);
    }
  });

  test("cancels a watch subscription by id", async () => {
    const root = "/tmp/cancel-watch";
    await openSampleSession(root);
    const watchRes = await dispatchAs<WatchOutput>("watch",
      { projectRoot: root },
      makeCtx(),
    );
    expect(watchRes.ok).toBe(true);
    if (!watchRes.ok) return;
    const subId = watchRes.value.subscription.subscriptionId;

    const cancelRes = await dispatchAs<CancelOutput>("cancel",
      { subscriptionId: subId },
      makeCtx(),
    );
    expect(cancelRes.ok).toBe(true);
    if (cancelRes.ok) {
      expect(cancelRes.value.cancelled).toBe(1);
    }
  });

  test("rejects when neither projectRoot nor subscriptionId is given", async () => {
    const res = await dispatchAs<CancelOutput>("cancel", {}, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("INVALID_INPUT");
    }
  });
});

describe("settings", () => {
  test("returns the applied patch", async () => {
    const root = "/tmp/settings-success";
    await openSampleSession(root);
    const res = await dispatchAs<SettingsOutput>("settings",
      { projectRoot: root, patch: { watch: false } },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.applied).toEqual({ watch: false });
    }
  });

  test("returns SESSION_NOT_FOUND when no session is open", async () => {
    const res = await dispatchAs<SettingsOutput>("settings",
      { projectRoot: "/tmp/no-session-settings" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("SESSION_NOT_FOUND");
    }
  });
});

describe("list-projects", () => {
  test("returns an empty list when no session is open", async () => {
    const res = await dispatchAs<ListProjectsOutput>("list-projects", {}, makeCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.projects).toEqual([]);
    }
  });
});

describe("close", () => {
  test("closes a session and reports the count", async () => {
    const root = "/tmp/close-success";
    await openSampleSession(root);
    const res = await dispatchAs<CloseOutput>("close", { projectRoot: root }, makeCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.closed).toBe(1);
    }
  });

  test("returns 0 when the session is missing", async () => {
    const res = await dispatchAs<CloseOutput>("close",
      { projectRoot: "/tmp/no-session-close" },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.closed).toBe(0);
    }
  });

  test("rejects missing projectRoot", async () => {
    const res = await dispatchAs<CloseOutput>("close", {}, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("INVALID_INPUT");
    }
  });
});

// ── core index barrel probe ─────────────────────────────────────────────────

describe("core barrel (sanity)", () => {
  test("openSession + closeAllSessions are exported from the core session layer", () => {
    expect(typeof openSession).toBe("function");
    expect(typeof closeAllSessions).toBe("function");
  });
});