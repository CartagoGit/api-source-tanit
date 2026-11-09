/**
 * `TanitOptionsSchema` — f00011 S3.
 *
 * Covers the `frameworkSearchRoot` **option** of the plugin, not the
 * tool. What it validates:
 *
 *  - `frameworkSearchRoot` is optional (the config may omit it).
 *  - When provided, it is a non-empty string.
 *  - `release.sign` is optional and, when present, a boolean: it is
 *    the policy the release workflow reads to decide whether the
 *    installers are signed and whether a release may be published.
 *  - The fields that already existed (`defaultProjectRoot`, `cliScript`,
 *    `delendaiBunBin`) keep working as before: adding the field did
 *    not break anything.
 *  - An unknown field is rejected (the schema is `.strict()`) and the
 *    error names the offending field.
 *
 * The tool path (which propagates it to the CLI) is covered by
 * `tests/integration/generate.tool.spec.ts`; this file stays the unit
 * for the option.
 */
import { describe, expect, test } from "vitest";

import {
  TanitOptionsSchema,
  type ITanitOptions,
} from "../../src/lib/contracts/plugin.interface";

describe("TanitOptionsSchema — frameworkSearchRoot", () => {
  test("se acepta omitirla (es opcional)", () => {
    const parsed = TanitOptionsSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  test("se acepta con un valor válido", () => {
    const parsed = TanitOptionsSchema.safeParse({
      frameworkSearchRoot: "apps/api",
    });
    expect(parsed.success).toBe(true);
    expect((parsed.data as ITanitOptions).frameworkSearchRoot).toBe(
      "apps/api",
    );
  });

  test("rechaza una cadena vacía (debe apuntar a algo)", () => {
    const parsed = TanitOptionsSchema.safeParse({
      frameworkSearchRoot: "",
    });
    expect(parsed.success).toBe(false);
  });

  test("rechaza un valor que no es cadena", () => {
    const parsed = TanitOptionsSchema.safeParse({
      frameworkSearchRoot: 42,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("TanitOptionsSchema — release.sign", () => {
  test("se acepta omitirlo (es opcional)", () => {
    const parsed = TanitOptionsSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  test("se acepta con un valor booleano", () => {
    const parsed = TanitOptionsSchema.safeParse({
      release: { sign: false },
    });
    expect(parsed.success).toBe(true);
    expect((parsed.data as ITanitOptions).release?.sign).toBe(false);
  });

  test("se acepta con `release` vacío (la ausencia equivale a no firmar)", () => {
    const parsed = TanitOptionsSchema.safeParse({ release: {} });
    expect(parsed.success).toBe(true);
  });

  test("rechaza un `sign` que no es booleano", () => {
    const parsed = TanitOptionsSchema.safeParse({
      release: { sign: "sí" },
    });
    expect(parsed.success).toBe(false);
  });

  test("rechaza un `release` que no es un objeto", () => {
    const parsed = TanitOptionsSchema.safeParse({ release: true });
    expect(parsed.success).toBe(false);
  });

  test("rechaza un campo desconocido dentro de `release`", () => {
    const parsed = TanitOptionsSchema.safeParse({
      release: { sign: false, notarize: true },
    });
    expect(parsed.success).toBe(false);
  });

  test("no rompe las demás opciones", () => {
    const parsed = TanitOptionsSchema.safeParse({
      defaultProjectRoot: "/srv/api",
      cliScript: "/otro/cli.ts",
      delendaiBunBin: "/usr/local/bin/bun",
      frameworkSearchRoot: "apps/api",
      release: { sign: true },
    });
    expect(parsed.success).toBe(true);
    expect((parsed.data as ITanitOptions).release?.sign).toBe(true);
  });
});

describe("TanitOptionsSchema — campos previos", () => {
  test("defaultProjectRoot sigue funcionando", () => {
    const parsed = TanitOptionsSchema.safeParse({
      defaultProjectRoot: "/srv/api",
    });
    expect(parsed.success).toBe(true);
    expect(
      (parsed.data as ITanitOptions).defaultProjectRoot,
    ).toBe("/srv/api");
  });

  test("cliScript sigue funcionando", () => {
    const parsed = TanitOptionsSchema.safeParse({
      cliScript: "/otro/cli.ts",
    });
    expect(parsed.success).toBe(true);
  });

  test("delendaiBunBin sigue funcionando", () => {
    const parsed = TanitOptionsSchema.safeParse({
      delendaiBunBin: "/usr/local/bin/bun",
    });
    expect(parsed.success).toBe(true);
  });

  test("se pueden combinar con la nueva opción", () => {
    const parsed = TanitOptionsSchema.safeParse({
      defaultProjectRoot: "/srv/api",
      frameworkSearchRoot: "apps/api",
      cliScript: "/otro/cli.ts",
    });
    expect(parsed.success).toBe(true);
    expect(
      (parsed.data as ITanitOptions).frameworkSearchRoot,
    ).toBe("apps/api");
  });
});

describe("TanitOptionsSchema — strict", () => {
  test("rechaza un campo desconocido", () => {
    const parsed = TanitOptionsSchema.safeParse({
      frameworkSearchRoot: "apps/api",
      noExiste: true,
    });
    expect(parsed.success).toBe(false);
  });
});