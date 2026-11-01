/**
 * Extra branches of `packages/ui/ansi.helper.ts`.
 *
 * `tests/cli/tui.spec.ts` covers the typical cases (color on/off,
 * alignment with ANSI, table rendering, dashboard rendering). What
 * it does **not** cover is the small-but-tedious set of defensive
 * branches in `truncate`, `padEnd`, `padStart` and `terminalWidth`
 * that matter whenever the input is degenerate: empty width, text
 * already wider than the width, `process.stdout.columns` undefined,
 * or absurd values like `160+`.
 *
 * These were 0% in the coverage report before this spec.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  padEnd,
  padStart,
  terminalWidth,
  truncate,
  visibleWidth,
} from "../../packages/ui/ansi.helper";
import { DEFAULT_TERMINAL_WIDTH } from "../../packages/contracts/constants/cli/terminal.constant";

describe("truncate — defensive branches", () => {
  test("max <= 0 returns empty string", () => {
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("hello", -1)).toBe("");
  });

  test("text already shorter than max is returned as-is", () => {
    expect(truncate("hi", 5)).toBe("hi");
  });

  test("max === 1 returns a single ellipsis", () => {
    expect(truncate("hello", 1)).toBe("…");
  });

  test("text with ANSI codes longer than max is trimmed after stripping", () => {
    const colored = "\u001b[31mhello world\u001b[0m";
    expect(visibleWidth(truncate(colored, 5))).toBe(5);
  });
});

describe("padEnd / padStart — defensive branches", () => {
  test("padEnd with width <= visible width is a no-op", () => {
    expect(padEnd("hello", 3)).toBe("hello");
  });

  test("padEnd pads by visible width, ignoring ANSI codes", () => {
    const colored = "\u001b[31mhi\u001b[0m";
    const padded = padEnd(colored, 6);
    expect(visibleWidth(padded)).toBe(6);
  });

  test("padStart with width <= visible width is a no-op", () => {
    expect(padStart("hello", 3)).toBe("hello");
  });

  test("padStart pads by visible width, ignoring ANSI codes", () => {
    const colored = "\u001b[31mhi\u001b[0m";
    const padded = padStart(colored, 6);
    expect(visibleWidth(padded)).toBe(6);
  });
});

describe("terminalWidth — defensive branches", () => {
  const stdout = process.stdout as { columns?: number };
  let original: number | undefined;

  beforeEach(() => {
    original = stdout.columns;
  });

  afterEach(() => {
    if (original === undefined) delete stdout.columns;
    else stdout.columns = original;
  });

  test("undefined columns falls back to default", () => {
    delete stdout.columns;
    expect(terminalWidth()).toBe(DEFAULT_TERMINAL_WIDTH);
  });

  test("non-finite columns falls back to default", () => {
    (stdout as { columns: number }).columns = Number.NaN;
    expect(terminalWidth()).toBe(DEFAULT_TERMINAL_WIDTH);
  });

  test("columns < 20 falls back to default", () => {
    (stdout as { columns: number }).columns = 10;
    expect(terminalWidth()).toBe(DEFAULT_TERMINAL_WIDTH);
  });

  test("columns within range is returned as-is", () => {
    (stdout as { columns: number }).columns = 100;
    expect(terminalWidth()).toBe(100);
  });

  test("columns above 160 is clamped to 160", () => {
    (stdout as { columns: number }).columns = 400;
    expect(terminalWidth()).toBe(160);
  });
});