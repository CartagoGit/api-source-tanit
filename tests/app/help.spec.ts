import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HelpComponent } from "../../packages/app/src/app/features/help/help.component";

describe("Help", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  afterEach(() => vi.unstubAllGlobals());

  it("offers accessible shortcuts and repository links in the browser", () => {
    const fixture = TestBed.createComponent(HelpComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector("dl")?.textContent).toContain("Enter");
    const links = Array.from(element.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://github.com/CartagoGit/api-source-tanit",
      "https://github.com/CartagoGit/api-source-tanit/issues",
      "https://github.com/CartagoGit/api-source-tanit/issues/new/choose",
    ]);
    expect(links.every((link) => link.target === "_blank" && link.relList.contains("noopener"))).toBe(true);
    const event = new MouseEvent("click", { cancelable: true });
    void fixture.componentInstance.openLink(event, fixture.componentInstance.repository);
    expect(event.defaultPrevented).toBe(false);
  });

  it("opens desktop links externally and surfaces a rejected launch", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("blocked"));
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    const fixture = TestBed.createComponent(HelpComponent);
    const component = fixture.componentInstance;
    const event = new MouseEvent("click", { cancelable: true });

    await component.openLink(event, component.repository);
    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("plugin:shell|open", { path: component.repository });
    expect(component.linkFailed()).toBe(false);

    await component.openLink(event, component.issues);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).not.toBeNull();
  });
});
