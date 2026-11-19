/**
 * The app's languages, and the words in them.
 *
 * ## What these tests are for
 *
 * The app had a language that **did not exist**: no selector anywhere,
 * and a `localStorage` key that changed four strings out of a hundred
 * and fifty. Everything else was English written in the template.
 *
 * A language switch that changes nothing is worse than no switch — it
 * says the app speaks your language when it does not. These tests
 * pin the three things that make it real:
 *
 *   1. Changing the language changes **what the screen says**.
 *   2. The document says which language it is in (`lang`), because a
 *      page that says "es" and declares `lang="en"` lies twice.
 *   3. Every catalog has every word. A locale missing a key shows the
 *      key itself; a locale with a word nobody asks for is a catalog
 *      that drifted.
 *
 * The catalog parity is also what `bun run lint:app-i18n` enforces;
 * here it is checked from the other side — against the files that
 * ship — so a catalog that drifts is caught even if the gate is not
 * run.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";

import { I18nService } from "../../packages/app/src/app/core/i18n/i18n.service";
import { locale, setLocale, translate } from "../../packages/app/src/app/core/i18n/i18n.state";
import { SettingsComponent } from "../../packages/app/src/app/features/settings/settings.component";
import { BUNDLED_LOCALES } from "../../packages/contracts/constants/cli/locales.constant";

import en from "../../packages/app/src/app/core/i18n/locales/en.json";
import es from "../../packages/app/src/app/core/i18n/locales/es.json";
import fr from "../../packages/app/src/app/core/i18n/locales/fr.json";

describe("the app's languages", () => {
  beforeEach(() => {
    // The language is module state: it outlives the test that set
    // it, so it is put back the way it was found.
    localStorage.clear();
    setLocale("en");
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("says what it says in the language you chose", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const heading = (): string => fixture.nativeElement.querySelector("h2").textContent?.trim() ?? "";
    expect(heading()).toBe("Settings");

    fixture.componentInstance.i18n.setLocale("es");
    fixture.detectChanges();
    expect(heading()).toBe("Ajustes");

    fixture.componentInstance.i18n.setLocale("fr");
    fixture.detectChanges();
    expect(heading()).toBe("Réglages");
  });

  it("tells the document which language it is written in", () => {
    const service = TestBed.inject(I18nService);
    service.setLocale("es");
    expect(document.documentElement.getAttribute("lang")).toBe("es");

    service.setLocale("fr");
    expect(document.documentElement.getAttribute("lang")).toBe("fr");
  });

  it("offers the languages it ships, named in their own language", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll("select option") as NodeListOf<HTMLOptionElement>,
    ).map((option) => option.textContent?.trim());

    expect(options).toEqual(["English", "Español", "Français"]);
  });

  it("remembers the language you chose", () => {
    const service = TestBed.inject(I18nService);
    service.setLocale("es");
    expect(localStorage.getItem("tanit.locale")).toBe("es");
  });

  it("does not accept a language it cannot speak", () => {
    const service = TestBed.inject(I18nService);
    service.setLocale("klingon");
    expect(locale()).toBe("en");
  });

  it("says the key when nobody translated it", () => {
    // A key that is not in the catalog is visible, not invisible: an
    // empty space looks like a value that happens to be empty.
    expect(translate("nothing.knows.this")).toBe("nothing.knows.this");
  });

  it("puts the numbers in the sentence, and the words in the catalog", () => {
    expect(translate("endpoint.requestMany", { method: "GET", count: 3 })).toBe(
      "GET request with 3 parameters",
    );
    expect(translate("endpoint.requestOne", { method: "GET", count: 1 })).toBe(
      "GET request with 1 parameter",
    );
  });

  it("has the same words in every language", () => {
    const keys = (catalog: Record<string, string>): string[] => Object.keys(catalog).sort();
    expect(keys(es)).toEqual(keys(en));
    expect(keys(fr)).toEqual(keys(en));
  });

  it("speaks only the languages the product speaks", () => {
    const shipped = BUNDLED_LOCALES.map((entry) => entry.code);
    for (const code of ["en", "es", "fr"]) {
      expect(shipped).toContain(code);
    }
  });
});
