import { describe, expect, it } from "vitest";

import en from "../../packages/app/src/app/core/i18n/locales/en.json";
import es from "../../packages/app/src/app/core/i18n/locales/es.json";
import { I18nService } from "../../packages/app/src/app/core/i18n/i18n.service";
import { CommandStore } from "../../packages/app/src/app/core/state/command.store";
import { fuzzyMatch } from "../../packages/app/src/app/shell/command-palette.component";

describe("Angular shell foundation", () => {
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