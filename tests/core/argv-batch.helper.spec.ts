/**
 * x00066 — readFlags / readBooleanFlags / readFlagList.
 *
 * Replaces the manual `args.indexOf("--foo")` blocks the audit
 * identified as P2 #9. Every CLI flag goes through ONE helper,
 * so `--flag=value` and `--flag value` both work, and unknown
 * flags don't get accidentally swallowed.
 */
import { describe, expect, test } from "vitest";

import {
  readFlag,
  readFlags,
  readBooleanFlags,
  readFlagList,
} from "../../packages/core/helpers/argv.helper";

describe("x00066 — argv batch helpers", () => {
  describe("readFlags", () => {
    test("(1) reads a single value", () => {
      const out = readFlags(["--output", "/tmp/x.json"], { output: "--output" });
      expect(out.output).toBe("/tmp/x.json");
    });

    test("(2) reads multiple values in one pass", () => {
      const out = readFlags(
        ["--output", "/x.json", "--basename", "foo", "--framework", "express"],
        {
          output: "--output",
          basename: "--basename",
          framework: "--framework",
        },
      );
      expect(out.output).toBe("/x.json");
      expect(out.basename).toBe("foo");
      expect(out.framework).toBe("express");
    });

    test("(3) accepts `--flag=value`", () => {
      const out = readFlags(["--output=/tmp/x.json"], { output: "--output" });
      expect(out.output).toBe("/tmp/x.json");
    });

    test("(4) returns undefined when absent", () => {
      const out = readFlags([], { output: "--output" });
      expect(out.output).toBeUndefined();
    });

    test("(5) handles `--flag --next-flag` (no value) as undefined", () => {
      const out = readFlags(["--output", "--json"], { output: "--output" });
      expect(out.output).toBeUndefined();
    });

    test("(6) order does not matter", () => {
      const out = readFlags(
        ["--framework", "express", "--output", "/x"],
        { output: "--output", framework: "--framework" },
      );
      expect(out.framework).toBe("express");
      expect(out.output).toBe("/x");
    });
  });

  describe("readBooleanFlags", () => {
    test("(7) reads boolean flags", () => {
      const out = readBooleanFlags(
        ["--combine-services", "--inspect"],
        { combineServices: "--combine-services", inspect: "--inspect" },
      );
      expect(out.combineServices).toBe(true);
      expect(out.inspect).toBe(true);
    });

    test("(8) missing flags are false", () => {
      const out = readBooleanFlags([], { combineServices: "--combine-services" });
      expect(out.combineServices).toBe(false);
    });

    test("(9) accepts `--flag=value` as true", () => {
      const out = readBooleanFlags(["--inspect=true"], { inspect: "--inspect" });
      expect(out.inspect).toBe(true);
    });
  });

  describe("readFlagList", () => {
    test("(10) reads comma-separated list", () => {
      const list = readFlagList(["--format", "openapi,bruno"], "--format");
      expect(list).toEqual(["openapi", "bruno"]);
    });

    test("(11) trims whitespace", () => {
      const list = readFlagList(["--format", "openapi , bruno"], "--format");
      expect(list).toEqual(["openapi", "bruno"]);
    });

    test("(12) drops empty entries", () => {
      const list = readFlagList(["--format", "openapi,,bruno"], "--format");
      expect(list).toEqual(["openapi", "bruno"]);
    });

    test("(13) absent flag returns empty array", () => {
      const list = readFlagList([], "--format");
      expect(list).toEqual([]);
    });
  });

  describe("backwards compat", () => {
    test("(14) readFlag still works", () => {
      expect(readFlag(["--foo", "bar"], "--foo")).toBe("bar");
    });
  });
});