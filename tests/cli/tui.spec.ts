/**
 * The visual pieces of the wizard.
 *
 * They are tested on their own because they are pure: given a text
 * and a width, a string comes out. What is checked is not that "it
 * looks nice" —that cannot be measured— but the three things that
 * truly break and only show up in someone else's terminal: that
 * color turns off when no one is looking, that a colored cell does
 * not skew the table, and that a narrow terminal does not split the
 * rows.
 */
import { describe, expect, test } from "vitest";

import {
  createPainter,
  padEnd,
  shouldUseColor,
  truncate,
  visibleWidth,
} from "../../packages/ui/ansi.helper";
import { DEFAULT_TERMINAL_WIDTH } from "../../packages/contracts/constants/cli/terminal.constant";
import { renderTable } from "../../packages/ui/table.helper";
import { bar, renderDashboard } from "../../packages/ui/dashboard.helper";

const color = createPainter(true);
const plain = createPainter(false);

describe("when there is color", () => {
  // https://no-color.org — if set, no color, no matter what.
  test("`NO_COLOR` wins over everything, even a TTY", () => {
    expect(shouldUseColor({ NO_COLOR: "" }, true)).toBe(false);
    expect(shouldUseColor({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
  });

  // A pipe or a file do not draw: there the color is garbage in the text.
  test("without TTY nothing is painted", () => {
    expect(shouldUseColor({}, false)).toBe(false);
  });

  test("`FORCE_COLOR` turns it on even without a TTY", () => {
    expect(shouldUseColor({ FORCE_COLOR: "1" }, false)).toBe(true);
  });

  test("`FORCE_COLOR=0` does not count as turning it on", () => {
    expect(shouldUseColor({ FORCE_COLOR: "0" }, false)).toBe(false);
  });

  test("`TERM=dumb` turns it off", () => {
    expect(shouldUseColor({ TERM: "dumb" }, true)).toBe(false);
  });

  test("with TTY and nothing weird, yes", () => {
    expect(shouldUseColor({ TERM: "xterm-256color" }, true)).toBe(true);
  });

  test("a turned-off painter returns the text unchanged", () => {
    expect(plain.paint("hola", "green")).toBe("hola");
    expect(plain.style("hola", "bold", "red")).toBe("hola");
  });
});

describe("visible width", () => {
  // The classic alignment failure with color: escape codes take zero
  // on screen and a lot in the string.
  test("ANSI sequences do not count", () => {
    const painted = color.paint("GET", "green");
    expect(painted.length).toBeGreaterThan(3);
    expect(visibleWidth(painted)).toBe(3);
  });

  test("`padEnd` pads by what is visible, not by what is real", () => {
    expect(visibleWidth(padEnd(color.paint("GET", "green"), 8))).toBe(8);
    expect(visibleWidth(padEnd("GET", 8))).toBe(8);
  });

  test("`truncate` respects the requested width", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(visibleWidth(truncate(color.paint("abcdefghij", "red"), 5))).toBe(5);
  });

  test("`truncate` does not touch what already fits", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });
});

describe("the table", () => {
  const columns = [
    { header: "Método", min: 6 },
    { header: "URI", min: 10 },
  ];
  const rows = [
    ["GET", "/api/users"],
    ["DELETE", "/api/users/{{id}}"],
  ];

  test("header, separator and one line per row", () => {
    const lines = renderTable(columns, rows, 60);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^─+\s+─+$/);
  });

  test("all rows measure the same except for the trailing trim", () => {
    const lines = renderTable(columns, rows, 60);
    // The position where the second column starts is compared.
    const starts = lines.map((l) => l.indexOf("/") === -1 ? null : l.indexOf("/"));
    const real = starts.filter((s): s is number => s !== null);
    expect(new Set(real).size).toBe(1);
  });

  // A table wider than the window is split by the emulator wherever
  // it pleases, and stops being a table.
  test("never exceeds the given width", () => {
    for (const width of [20, 30, 40, 80]) {
      for (const line of renderTable(columns, rows, width)) {
        expect(visibleWidth(line), `width ${width}: ${line}`).toBeLessThanOrEqual(width);
      }
    }
  });

  /**
   * Trimming every column equally ends up leaving the method as
   * `GE`, which says nothing, while the URI still has room to
   * spare. The widest column is trimmed.
   */
  test("trimming respects each column's minimum", () => {
    const lines = renderTable(columns, rows, 22);
    expect(lines[2]).toContain("GET");
    expect(lines[3]).toContain("DELETE");
  });

  test("with colored cells alignment is preserved", () => {
    const painted = [[color.paint("GET", "green"), "/a"], [color.paint("POST", "yellow"), "/b"]];
    const lines = renderTable(columns, painted, 60);
    expect(lines[2]?.indexOf("/a")).toBe(lines[3]?.indexOf("/b"));
  });

  test("without columns draws nothing", () => {
    expect(renderTable([], [], 80)).toEqual([]);
  });

  test("without rows keeps the header", () => {
    expect(renderTable(columns, [], 80)).toHaveLength(2);
  });

  test("does not leave trailing padding on the line", () => {
    for (const line of renderTable(columns, rows, 80)) {
      expect(line).toBe(line.trimEnd());
    }
  });
});

describe("the summary bars", () => {
  test("measure coverage, with their fraction and their percentage", () => {
    const line = bar(plain, "Reglas", 5, 9);
    expect(line).toContain("5/9");
    expect(line).toContain("56%");
  });

  test("filled and empty always add up to the same", () => {
    for (const [done, total] of [[0, 10], [5, 10], [10, 10], [3, 7]] as const) {
      const line = bar(plain, "x", done, total);
      const filled = (line.match(/█/g) ?? []).length;
      const empty = (line.match(/░/g) ?? []).length;
      expect(filled + empty, `${done}/${total}`).toBe(24);
    }
  });

  /**
   * A project without write endpoints does not have a body coverage
   * of 0% — it just does not apply. An empty bar reads as "bad".
   */
  test("with zero total it says `not applicable`, not 0%", () => {
    const line = bar(plain, "Bodies", 0, 0);
    expect(line).toContain("no aplica");
    expect(line).not.toContain("0%");
  });

  test("does not overflow the bar even if `done` exceeds `total`", () => {
    const line = bar(plain, "x", 20, 10);
    expect((line.match(/█/g) ?? []).length).toBe(24);
  });
});

describe("the whole summary", () => {
  const metrics = {
    framework: "express",
    requests: 9,
    folders: 3,
    withRules: 5,
    writeEndpoints: 5,
    withBody: 5,
    auth: { type: "bearer", evidence: "hay un endpoint de login" },
    warnings: ["dos frameworks a la vez"],
  };

  test("shows framework, endpoints, bars and auth", () => {
    const text = renderDashboard(plain, metrics).join("\n");
    expect(text).toContain("express");
    expect(text).toContain("9 en 3 carpetas");
    expect(text).toContain("Reglas");
    expect(text).toContain("bearer");
  });

  // An automatic detection that cannot be cross-checked has to be
  // taken on faith.
  test("the auth evidence sits next to the type", () => {
    expect(renderDashboard(plain, metrics).join("\n")).toContain("hay un endpoint de login");
  });

  test("the warnings are listed", () => {
    expect(renderDashboard(plain, metrics).join("\n")).toContain("dos frameworks a la vez");
  });

  // A coverage number without the action it suggests is a datum, not
  // a help.
  test("says how many endpoints need to be reviewed by hand", () => {
    expect(renderDashboard(plain, metrics).join("\n")).toContain("4 endpoint(s) with no rules");
  });

  test("with everything covered it does not suggest reviewing anything", () => {
    const perfect = { ...metrics, withRules: 9 };
    expect(renderDashboard(plain, perfect).join("\n")).not.toContain("with no rules in the code");
  });
});

describe("the default width", () => {
  test("is a reasonable terminal width", () => {
    expect(DEFAULT_TERMINAL_WIDTH).toBe(80);
  });
});
