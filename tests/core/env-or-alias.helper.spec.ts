/**
 * x00067 — envOrAlias() resolver.
 *
 * Canonical env var wins; deprecated alias is a one-warning fallback;
 * either set → trimmed string; neither set → undefined.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  envOrAlias,
  __resetEnvAliasWarningsForTest,
} from "../../packages/core/helpers/env-or-alias.helper";

describe("x00067 — envOrAlias()", () => {
  beforeEach(() => {
    __resetEnvAliasWarningsForTest();
    delete process.env["TANIT_FOO"];
    delete process.env["POSTMAN_FOO"];
    delete process.env["TANIT_SUPPRESS_DEPRECATION"];
  });
  afterEach(() => {
    delete process.env["TANIT_FOO"];
    delete process.env["POSTMAN_FOO"];
    delete process.env["TANIT_SUPPRESS_DEPRECATION"];
  });

  test("(1) canonical wins over deprecated", () => {
    process.env["TANIT_FOO"] = "new";
    process.env["POSTMAN_FOO"] = "old";
    expect(envOrAlias("TANIT_FOO", "POSTMAN_FOO")).toBe("new");
  });

  test("(2) falls back to deprecated when canonical is unset", () => {
    process.env["POSTMAN_FOO"] = "old";
    expect(envOrAlias("TANIT_FOO", "POSTMAN_FOO")).toBe("old");
  });

  test("(3) undefined when neither is set", () => {
    expect(envOrAlias("TANIT_FOO", "POSTMAN_FOO")).toBeUndefined();
  });

  test("(4) trims whitespace", () => {
    process.env["TANIT_FOO"] = "  value  ";
    expect(envOrAlias("TANIT_FOO", "POSTMAN_FOO")).toBe("value");
  });

  test("(5) empty string is treated as unset for both", () => {
    process.env["TANIT_FOO"] = "";
    process.env["POSTMAN_FOO"] = "";
    expect(envOrAlias("TANIT_FOO", "POSTMAN_FOO")).toBeUndefined();
  });

  test("(6) emits deprecation warning once per deprecated key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      process.env["POSTMAN_FOO"] = "old";
      envOrAlias("TANIT_FOO", "POSTMAN_FOO");
      envOrAlias("TANIT_FOO", "POSTMAN_FOO");
      envOrAlias("TANIT_FOO", "POSTMAN_FOO");
      const hits = warn.mock.calls.filter((args) =>
        String(args[0]).includes("POSTMAN_FOO"),
      );
      expect(hits).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("(7) canonical reads do not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      process.env["TANIT_FOO"] = "new";
      envOrAlias("TANIT_FOO", "POSTMAN_FOO");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("(8) TANIT_SUPPRESS_DEPRECATION=1 silences the warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      process.env["TANIT_SUPPRESS_DEPRECATION"] = "1";
      process.env["POSTMAN_FOO"] = "old";
      envOrAlias("TANIT_FOO", "POSTMAN_FOO");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});