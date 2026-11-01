/**
 * The parts of the app that a person can reach — and that answer.
 *
 * ## What these tests are for
 *
 * The app had entries in the sidebar that led nowhere, a section
 * that drew nothing, a scroller whose scroll was never listened to,
 * a filter that asked the backend once per keystroke, and a command
 * palette that threw the keyboard user's focus away when it closed.
 *
 * None of that shows in a screenshot. All of it shows the first time
 * somebody uses the app with a keyboard, on a big project, with the
 * network slow.
 *
 * ## Why there are host components here
 *
 * The inputs are bound from a template instead of through
 * `ComponentRef.setInput`, because that is how the real app uses
 * them — so the test uses them the same way, and a broken binding
 * fails here too.
 *
 * ## Why this needed the Angular compiler
 *
 * These tests render templates. While the suite ran on plain esbuild,
 * the components reached Angular as **JIT**, and the JIT of Angular
 * cannot see `input()` signals — it answers `NG0303: Can't bind to
 * 'x' since it isn't a known property`. The reason is documented in
 * the Angular compiler itself: signal inputs are declared with
 * decorators in JIT because class members cannot be reflected
 * statically before the class is instantiated.
 *
 * The fix was not to avoid signal inputs but to compile the app the
 * way Angular does — with the Angular compiler — so the suite and
 * the build share the same semantics.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { Component } from "@angular/core";
import { By } from "@angular/platform-browser";

import { SidebarComponent } from "../../packages/app/src/app/shell/sidebar.component";
import { DiagnosticsComponent } from "../../packages/app/src/app/features/diagnostics/diagnostics.component";
import { FiltersComponent } from "../../packages/app/src/app/features/endpoints/filters.component";
import { CommandPaletteComponent } from "../../packages/app/src/app/shell/command-palette.component";
import { VirtualScrollerComponent } from "../../packages/app/src/app/shared/virtual-scroll/virtual-scroller.component";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";
import type { EndpointQuery } from "../../packages/app/src/app/core/api/endpoints.client";

@Component({
  standalone: true,
  imports: [SidebarComponent],
  template: `<tanit-sidebar [activeId]="activeId" (select)="chosen = $event" />`,
})
class SidebarHost {
  activeId = "overview";
  chosen: string | null = null;
}

@Component({
  standalone: true,
  imports: [CommandPaletteComponent],
  template: `<tanit-command-palette [open]="open" (close)="open = false" (chosen)="chosen = $event" />`,
})
class PaletteHost {
  open = false;
  chosen: string | null = null;
}

@Component({
  standalone: true,
  imports: [FiltersComponent],
  template: `<tanit-endpoint-filters [value]="value" (changed)="changed = $event" />`,
})
class FiltersHost {
  value: EndpointQuery = {};
  changed: EndpointQuery | null = null;
}

@Component({
  standalone: true,
  imports: [VirtualScrollerComponent],
  template: `
    <ng-template #row let-item>{{ item }}</ng-template>
    <tanit-virtual-scroller [items]="items" [itemHeight]="64" [height]="192" [itemTemplate]="row" />
  `,
})
class ScrollerHost {
  items: readonly number[] = [1, 2, 3, 4, 5];
}

/** Lets the promises settle and the DOM settle with them. */
async function settle(ms = 10): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, ms); });
}

describe("the sidebar", () => {
  it("groups the navigation, so it says what the app is for", () => {
    const fixture = TestBed.createComponent(SidebarHost);
    fixture.detectChanges();

    const groups = fixture.nativeElement.querySelectorAll(".group") as NodeListOf<Element>;
    expect(groups.length).toBeGreaterThan(1);
    // Each group has a heading that labels it.
    for (const group of Array.from(groups)) {
      const heading = group.querySelector("h2");
      expect(heading?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("marks the section the user is in", () => {
    const fixture = TestBed.createComponent(SidebarHost);
    fixture.componentInstance.activeId = "endpoints";
    fixture.detectChanges();

    const current = fixture.nativeElement.querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].textContent?.trim()).toContain("Endpoints");
  });

  it("has no entry that leads nowhere", () => {
    const fixture = TestBed.createComponent(SidebarHost);
    fixture.detectChanges();

    const sidebar = fixture.debugElement.query(By.directive(SidebarComponent))
      ?.componentInstance as SidebarComponent;
    const ids = sidebar.groups.flatMap((group) => group.items.map((item) => item.id));
    // `schemas` was an entry with no section behind it: the shell
    // had no case for it and it opened a blank page.
    expect(ids).not.toContain("schemas");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the diagnostics section", () => {
  it("draws what the scan reported", () => {
    const request = vi.fn(async () => {
      throw new Error("unexpected operation");
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DiagnosticsComponent,
        ProjectStore,
        { provide: HostBridgeClient, useValue: { request } },
      ],
    });
    const project = TestBed.inject(ProjectStore);
    // The backend already knew: the summary carries what the scan
    // noticed. The app used to throw it away.
    project.summary.set({
      sessionId: "session-1",
      projectRoot: "/workspace/api",
      capturedAt: "2026-11-01T10:00:00.000Z",
      frameworks: ["express"],
      endpointCount: 3,
      serviceCount: 1,
      diagnostics: [
        { severity: "warning", message: "Folder 'src' is not a route file." },
        { severity: "error", message: "The scanner could not read one file.", source: "express" },
      ],
    });

    const fixture = TestBed.createComponent(DiagnosticsComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("Folder 'src' is not a route file.");
    expect(text).toContain("The scanner could not read one file.");
    expect(fixture.nativeElement.querySelectorAll("li.error").length).toBe(1);
  });

  it("says so when there is nothing to report", () => {
    const request = vi.fn(async () => {
      throw new Error("unexpected operation");
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DiagnosticsComponent,
        ProjectStore,
        { provide: HostBridgeClient, useValue: { request } },
      ],
    });

    const fixture = TestBed.createComponent(DiagnosticsComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("Nothing to report");
  });
});

describe("the endpoint filters", () => {
  it("asks the backend once for a word, not once per letter", async () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(FiltersHost);
      fixture.detectChanges();

      const search = fixture.nativeElement.querySelector(".search input") as HTMLInputElement;
      for (const value of ["o", "or", "ord", "orders"]) {
        search.value = value;
        search.dispatchEvent(new Event("input"));
        await vi.advanceTimersByTimeAsync(50);
      }
      // The last call is still pending: the word is not finished.
      expect(fixture.componentInstance.changed).toBeNull();

      await vi.advanceTimersByTimeAsync(300);

      expect(fixture.componentInstance.changed).toMatchObject({ search: "orders" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the letter at once, without waiting for the backend", () => {
    const fixture = TestBed.createComponent(FiltersHost);
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector(".search input") as HTMLInputElement;
    search.value = "or";
    search.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector(".search input") as HTMLInputElement).value).toBe("or");
  });
});

describe("the command palette", () => {
  it("gives the focus back to whoever had it", async () => {
    const fixture = TestBed.createComponent(PaletteHost);
    fixture.detectChanges();

    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fixture.componentInstance.open = true;
    fixture.detectChanges();
    await settle();
    expect(document.activeElement).not.toBe(opener);

    fixture.componentInstance.open = false;
    fixture.detectChanges();
    await settle();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("announces the option it is on", () => {
    const fixture = TestBed.createComponent(PaletteHost);
    fixture.componentInstance.open = true;
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-activedescendant")).toBe("palette-option-0");
    expect(
      fixture.nativeElement.querySelector('[role="option"]')?.getAttribute("id"),
    ).toBe("palette-option-0");
  });
});

describe("the virtual scroller", () => {
  it("says which range is on screen when it scrolls", () => {
    const fixture = TestBed.createComponent(ScrollerHost);
    fixture.detectChanges();

    const scroller = fixture.debugElement.query(By.directive(VirtualScrollerComponent))
      ?.componentInstance as VirtualScrollerComponent<number> | undefined;
    expect(scroller).toBeDefined();
    const ranges: Array<{ start: number; end: number }> = [];
    scroller?.rangeChange.subscribe((range) => ranges.push(range));

    const viewport = fixture.nativeElement.querySelector(".viewport") as HTMLElement;
    viewport.scrollTop = 128;
    viewport.dispatchEvent(new Event("scroll"));

    expect(ranges.length).toBe(1);
    expect(ranges[0]?.start).toBe(2);
    expect(ranges[0]?.end).toBe(5);
  });
});
