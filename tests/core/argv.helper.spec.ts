/**
 * Reading a flag, with a single answer.
 *
 * There were four copies of this function and they disagreed: two
 * returned `null`, one returned `undefined`, and the fourth had its
 * arguments in the wrong order. None of that breaks the compiler — it
 * shows up when someone writes `flag === undefined` over the one that
 * returns `null`, or copies a call from one file to another and it
 * compiles doing something else.
 */
import { describe, expect, test } from "vitest";

import { hasFlag, readFlag } from "../../packages/core/helpers/argv.helper";

describe("readFlag", () => {
  test("reads `--flag value`", () => {
    expect(readFlag(["--output-dir", "/tmp/x"], "--output-dir")).toBe("/tmp/x");
  });

  /**
   * Half of the developers write the attached form, and almost every
   * script generates it. None of the four copies supported it: the flag
   * looked missing.
   */
  test("also reads `--flag=value`", () => {
    expect(readFlag(["--output-dir=/tmp/x"], "--output-dir")).toBe("/tmp/x");
  });

  test("a missing flag yields `undefined`", () => {
    expect(readFlag(["--other", "x"], "--output-dir")).toBeUndefined();
  });

  test("does not confuse a flag with another that starts the same way", () => {
    expect(readFlag(["--output", "f.json"], "--output-dir")).toBeUndefined();
  });

  /**
   * `--output-dir --json`: the next argument is another flag, not a
   * value. Without this check, `--output-dir` without a value would
   * swallow `--json` and the CLI would write into a folder called
   * `--json`.
   */
  test("a flag without a value does not swallow the next flag", () => {
    expect(readFlag(["--output-dir", "--json"], "--output-dir")).toBeUndefined();
  });

  test("a flag at the end, with nothing after it", () => {
    expect(readFlag(["--output-dir"], "--output-dir")).toBeUndefined();
  });

  test("an empty attached value is an empty value, not a missing flag", () => {
    expect(readFlag(["--output-dir="], "--output-dir")).toBe("");
  });

  test("the first occurrence wins", () => {
    expect(readFlag(["--f", "a", "--f", "b"], "--f")).toBe("a");
  });
});

describe("hasFlag", () => {
  test("recognizes a standalone flag", () => {
    expect(hasFlag(["--json"], "--json")).toBe(true);
  });

  test("and the one with an attached value", () => {
    expect(hasFlag(["--format=openapi"], "--format")).toBe(true);
  });

  test("and reports no when it is not present", () => {
    expect(hasFlag(["--other"], "--json")).toBe(false);
  });
});
