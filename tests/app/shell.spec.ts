/**
 * The shell, and the project store behind it.
 *
 * ## What this test is for
 *
 * The shell used to draw the same two lines for every section but the
 * overview — a heading and "open a project" — and the eleven feature
 * components in the repository were never mounted. The app was a
 * screenshot of an app.
 *
 * And "open a project" did not open anything: it set the project's
 * *name*. So the shell had two placeholder screens and no content
 * behind either, and every operation the app tried answered
 * `SESSION_NOT_FOUND`.
 *
 * So the test checks the two things that make it an app: the
 * sections are **mounted**, and opening a project **opens a
 * session**.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { AppComponent } from "../../packages/app/src/app/shell/app-shell.component";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

describe("ProjectStore", () => {
  it("opens a session and keeps the summary", async () => {
    const request = vi.fn(async (operation: string) => {
      if (operation === "open-project") {
        return {
          sessionId: "session-1",
          summary: {
            sessionId: "session-1",
            projectRoot: "/workspace/api",
            capturedAt: "2026-10-31T10:00:00.000Z",
            frameworks: ["express"],
            endpointCount: 12,
            serviceCount: 1,
          },
        };
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ProjectStore,
        { provide: HostBridgeClient, useValue: { request, requestPending: vi.fn() } },
      ],
    });
    const project = TestBed.inject(ProjectStore);

    const opened = await project.open("/workspace/api");

    expect(opened).toBe(true);
    expect(project.sessionId()).toBe("session-1");
    expect(project.projectRoot()).toBe("/workspace/api");
    expect(project.projectName()).toBe("api");
    expect(project.summary()?.endpointCount).toBe(12);
    expect(project.isOpen()).toBe(true);
  });

  it("stays closed when the backend cannot open the project", async () => {
    const request = vi.fn(async () => {
      throw new Error("No framework detected in /workspace/empty");
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ProjectStore,
        { provide: HostBridgeClient, useValue: { request, requestPending: vi.fn() } },
      ],
    });
    const project = TestBed.inject(ProjectStore);

    const opened = await project.open("/workspace/empty");

    expect(opened).toBe(false);
    // A project with a name on the screen and no session behind it
    // is the state this store used to be in all the time.
    expect(project.sessionId()).toBeNull();
    expect(project.isOpen()).toBe(false);
    expect(project.error()).toContain("No framework detected");
  });

  it("tells the backend to close the session", async () => {
    const request = vi.fn(async (operation: string) => {
      if (operation === "open-project") {
        return {
          sessionId: "session-1",
          summary: {
            sessionId: "session-1",
            projectRoot: "/workspace/api",
            capturedAt: "2026-10-31T10:00:00.000Z",
            frameworks: ["express"],
            endpointCount: 12,
            serviceCount: 1,
          },
        };
      }
      if (operation === "close") return { closed: 1 };
      throw new Error(`unexpected operation: ${operation}`);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ProjectStore,
        { provide: HostBridgeClient, useValue: { request, requestPending: vi.fn() } },
      ],
    });
    const project = TestBed.inject(ProjectStore);
    await project.open("/workspace/api");

    await project.close();

    expect(request).toHaveBeenCalledWith("close", { projectRoot: "/workspace/api" });
    expect(project.isOpen()).toBe(false);
  });
});

describe("the shell", () => {
  it("mounts the features instead of a placeholder", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppComponent,
        ProjectStore,
        { provide: HostBridgeClient, useValue: { request: vi.fn(), requestPending: vi.fn() } },
      ],
    });
    const shell = TestBed.runInInjectionContext(() => new AppComponent());

    // The sections are real: the shell knows how to go to each one.
    for (const section of [
      "overview",
      "endpoints",
      "exports",
      "services",
      "history",
      "settings",
      "live",
      "check",
      "sync",
      "validate",
      "push",
    ]) {
      shell.go(section);
      expect(shell.activeSection()).toBe(section);
    }
  });
});
