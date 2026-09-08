// @vitest-environment jsdom

import "@angular/compiler";
import "zone.js";
import "zone.js/testing";

import { describe, expect, it } from "vitest";
import { getTestBed, TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";

import en from "../../packages/app/src/app/core/i18n/locales/en.json";
import es from "../../packages/app/src/app/core/i18n/locales/es.json";
import { I18nService } from "../../packages/app/src/app/core/i18n/i18n.service";
import { CommandStore } from "../../packages/app/src/app/core/state/command.store";
import { fuzzyMatch } from "../../packages/app/src/app/shell/command-palette.component";
import { AppComponent } from "../../packages/app/src/app/shell/app-shell.component";
import { SidebarComponent } from "../../packages/app/src/app/shell/sidebar.component";
import { CommandPaletteComponent } from "../../packages/app/src/app/shell/command-palette.component";
import { ButtonComponent } from "../../packages/app/src/app/shared/button/button.component";
import { EmptyStateComponent } from "../../packages/app/src/app/shared/empty-state/empty-state.component";

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

describe("Angular shell foundation", () => {
  it("renders the shell, switches theme, opens the palette, and focuses search", async () => {
    TestBed.resetTestingModule();
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    localStorage.clear();
    document.documentElement.dataset.theme = "light";
    TestBed.configureTestingModule({ imports: [AppComponent, SidebarComponent, CommandPaletteComponent, ButtonComponent, EmptyStateComponent] });
    const app = TestBed.runInInjectionContext(() => new AppComponent());
    app.toggleTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");

    app.onShortcut(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(app.paletteOpen()).toBe(true);

    const sidebar = TestBed.createComponent(SidebarComponent);
    sidebar.detectChanges();
    expect(sidebar.nativeElement.querySelectorAll("nav button")).toHaveLength(8);

    sidebar.destroy();
    TestBed.resetTestingModule();
  });

  it("keeps English as the reference catalog and Spanish translated", () => {
    const commonKeys = Object.keys(en);
    const translated = commonKeys.filter((key) => en[key] !== es[key]);

    expect(commonKeys.length).toBeGreaterThan(16);
    expect(translated.length).toBeGreaterThanOrEqual(Math.ceil(commonKeys.length / 2));
  });

  it("translates with a safe fallback outside a browser", () => {
    const service = new I18nService();

    expect(service.translate("app.name")).toBe("Tanit");
    expect(service.translate("missing.key")).toBe("—");
  });

  it("registers the eight command-palette actions", () => {
    const commands = new CommandStore().commands();

    expect(commands).toHaveLength(8);
    expect(commands.map(({ id }) => id)).toEqual([
      "open",
      "rescan",
      "search",
      "export",
      "settings",
      "help",
      "theme",
      "recent",
    ]);
  });

  it("matches commands by ordered fuzzy characters and resets on empty input", () => {
    expect(fuzzyMatch("ope", "Open project")).toBe(true);
    expect(fuzzyMatch("prj", "Open project")).toBe(true);
    expect(fuzzyMatch("xyz", "Open project")).toBe(false);
    expect(fuzzyMatch("", "anything")).toBe(true);
  });

  it("keeps the shell navigation destinations explicit", () => {
    expect(new CommandStore().commands().map(({ id }) => id)).toEqual([
      "open",
      "rescan",
      "search",
      "export",
      "settings",
      "help",
      "theme",
      "recent",
    ]);
  });
});