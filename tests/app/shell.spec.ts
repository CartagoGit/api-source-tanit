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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { Location } from "@angular/common";
import { provideLocationMocks } from "@angular/common/testing";

import { AppComponent } from "../../packages/app/src/app/shell/app-shell.component";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { FolderPickerComponent } from "../../packages/app/src/app/features/home/folder-picker.component";
import { RecentProjectsClient } from "../../packages/app/src/app/core/api/recent-projects.client";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

beforeEach(() => sessionStorage.clear());

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
        { provide: HostBridgeClient, useValue: { request } },
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
        { provide: HostBridgeClient, useValue: { request } },
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

  it("keeps the current session when a replacement cannot open", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ sessionId: "session", summary: { projectRoot: "/workspace/api" } })
      .mockRejectedValueOnce(new Error("Folder unavailable"));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HostBridgeClient, useValue: { request } }] });
    const project = TestBed.inject(ProjectStore);
    expect(await project.open("  /workspace/api  ")).toBe(true);
    expect(await project.open("/workspace/invalid")).toBe(false);
    expect(request).toHaveBeenNthCalledWith(1, "open-project", { projectRoot: "/workspace/api" });
    expect(project.projectRoot()).toBe("/workspace/api");
    expect(project.sessionId()).toBe("session");
    expect(project.error()).toBe("Folder unavailable");
  });

  it("restores the canonical project from this tab after reload", async () => {
    const request = vi.fn().mockResolvedValue({ sessionId: "reopened", summary: { projectRoot: "/workspace/api" } });
    sessionStorage.setItem("tanit.open-project", "/workspace/api");
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HostBridgeClient, useValue: { request } }] });
    const project = TestBed.inject(ProjectStore);
    await project.restore();
    expect(request).toHaveBeenCalledWith("open-project", { projectRoot: "/workspace/api" });
    expect(project.sessionId()).toBe("reopened");
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
        { provide: HostBridgeClient, useValue: { request } },
      ],
    });
    const project = TestBed.inject(ProjectStore);
    await project.open("/workspace/api");

    await project.close();

    expect(request).toHaveBeenCalledWith("close", { projectRoot: "/workspace/api" });
    expect(sessionStorage.getItem("tanit.open-project")).toBeNull();
    expect(project.isOpen()).toBe(false);
  });
});

describe("the shell", () => {
  it("mounts the features instead of a placeholder", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppComponent,
        ...provideLocationMocks(),
        ProjectStore,
        { provide: HostBridgeClient, useValue: { request: vi.fn() } },
      ],
    });

    const location = TestBed.inject(Location);
    location.go("/history");
    const shell = TestBed.runInInjectionContext(() => new AppComponent());
    expect(shell.activeSection()).toBe("history");

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
      expect(location.path()).toBe(section === "overview" ? "/" : `/${section}`);
    }
    location.back();
    expect(shell.activeSection()).toBe("validate");
  });
});


describe("the browser folder picker", () => {
  it("lists backend folders and emits the path of the chosen directory", async () => {
    const listing = (path: string, parent: string | null) => ({
      ok: true, path, parent, entries: [], truncated: false,
    });
    const browse = vi.fn()
      .mockResolvedValueOnce(listing("C:\\work", null))
      .mockResolvedValueOnce(listing("C:\\work\\project", "C:\\work"));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: RecentProjectsClient, useValue: { browse } }] });
    const picker = TestBed.runInInjectionContext(() => new FolderPickerComponent());
    const selected = vi.fn();
    picker.selected.subscribe(selected);
    await picker.toggleBrowse();
    expect(browse).toHaveBeenCalledWith(undefined);
    await picker.open("C:\\work\\project");
    expect(selected).not.toHaveBeenCalled();
    picker.useCurrent();
    expect(selected).toHaveBeenCalledWith("C:\\work\\project");
  });
});
