/**
 * The look of the interface, in variables.
 *
 * What is checked here is not that the colors are nice —that cannot
 * be tested— but the two properties that make a theme work:
 *
 *   1. **No rule writes a color hardcoded.** If one did, that
 *      element would look the same in both themes: fine in the one it
 *      was written for and broken in the other. It is the failure that
 *      takes longest to surface, because you have to open the other
 *      theme to see it.
 *   2. **Both themes define the same variables.** A theme that lacks
 *      one shows nothing visible: it inherits the other and looks
 *      wrong in one specific spot.
 */
import { describe, expect, test } from "vitest";

import {
  DEFAULT_THEME,
  THEME_MODES,
  THEME_VARIABLES,
} from "../../packages/contracts/constants/cli/theme.constant";
import { UI_STYLES } from "../../packages/ui/web/theme.constant";

/** The blocks that declare variables: `:root`, the system one and the chosen one. */
function bloquesDeVariables(css: string): string[] {
  return [...css.matchAll(/\{([^{}]*--[^{}]*)\}/g)].map((m) => m[1] ?? "");
}

describe("los modos", () => {
  test("are three: system, light and dark", () => {
    expect([...THEME_MODES]).toEqual(["system", "light", "dark"]);
  });

  /**
   * Whoever has their system in dark mode does so for a reason, and
   * opening an application in bright white is exactly what they
   * configured to prevent.
   */
  test("the default follows the system, does not impose one", () => {
    expect(DEFAULT_THEME).toBe("system");
  });
});

describe("both themes say the same thing", () => {
  test("the light one defines all declared variables", () => {
    const raiz = bloquesDeVariables(UI_STYLES)[0] ?? "";
    for (const variable of THEME_VARIABLES) {
      expect(raiz, `missing ${variable} in light theme`).toContain(`${variable}:`);
    }
  });

  /** THE test: an incomplete theme inherits from the other and looks wrong in one spot. */
  test("the dark one defines exactly the same", () => {
    const oscuro = /:root\[data-tema="dark"\]\s*\{([^}]*)\}/.exec(UI_STYLES)?.[1] ?? "";
    expect(oscuro.length, "no dark theme block").toBeGreaterThan(0);
    for (const variable of THEME_VARIABLES) {
      expect(oscuro, `missing ${variable} in dark theme`).toContain(`${variable}:`);
    }
  });

  test("the system one too, so it does not half-inherit", () => {
    const sistema =
      /:root:not\(\[data-tema="light"\]\)\s*\{([^}]*)\}/.exec(UI_STYLES)?.[1] ?? "";
    expect(sistema.length).toBeGreaterThan(0);
    for (const variable of THEME_VARIABLES) {
      expect(sistema, `missing ${variable} in system theme`).toContain(
        `${variable}:`,
      );
    }
  });
});

describe("no color outside the variables", () => {
  /**
   * THE other test. The rules —what is not a variables block— are
   * inspected, and there no literal color can appear: everything must
   * be `var(--something)`.
   */
  test("the rules use `var()`, not literal values", () => {
    // The blocks that declare variables are removed: there literals
    // are exactly what is wanted.
    const soloReglas = UI_STYLES.replace(/\{[^{}]*--[^{}]*\}/g, "{}")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const literales = [
      ...soloReglas.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...soloReglas.matchAll(/\brgba?\([^)]*\)/g),
    ].map((m) => m[0]);

    expect(literales, "colors are hardcoded in a rule").toEqual([]);
  });

  test("and no bare color name either", () => {
    const soloReglas = UI_STYLES.replace(/\{[^{}]*--[^{}]*\}/g, "{}")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // `transparent` and `inherit` are not theme colors: they are
    // absence of color and inheritance, and neither changes between
    // themes.
    const sospechosos = [
      ...soloReglas.matchAll(
        /:\s*(white|black|red|green|blue|gray|grey|yellow|orange)\b/g,
      ),
    ].map((m) => m[1]);
    expect(sospechosos).toEqual([]);
  });
});

describe("accessibility is not optional", () => {
  /**
   * Visible focus is the only thing that tells someone navigating with
   * the keyboard where they are. Removing it makes the interface
   * unusable without a mouse, and it is one of the things that get
   * deleted "because it looks weird".
   */
  test("keyboard focus is visible", () => {
    expect(UI_STYLES).toContain(":focus-visible");
    expect(UI_STYLES).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  test("focus uses the variable, so it shows in both themes", () => {
    const regla = /:focus-visible\s*\{([^}]*)\}/.exec(UI_STYLES)?.[1] ?? "";
    expect(regla).toContain("var(--foco)");
  });
});
