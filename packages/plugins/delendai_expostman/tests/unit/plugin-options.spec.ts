/**
 * `ExportToPostmanOptionsSchema` — f00011 S3.
 *
 * Cubre la **opción** `frameworkSearchRoot` del plugin, no el tool.
 * Lo que valida:
 *
 *  - `frameworkSearchRoot` es opcional (la config puede omitirlo).
 *  - Cuando se da, es una cadena no vacía.
 *  - Los campos que ya existían (`defaultProjectRoot`, `cliScript`,
 *    `delendaiBunBin`) siguen funcionando como antes: no se rompió
 *    nada al añadir el campo.
 *  - Un campo desconocido se rechaza (la schema es `.strict()`) y el
 *    error señala el nombre del campo.
 *
 * El camino del tool (que la propaga al CLI) está cubierto por
 * `tests/integration/generate.tool.spec.ts`; aquí se queda la unidad
 * de la opción.
 */
import { describe, expect, test } from "vitest";

import {
  ExportToPostmanOptionsSchema,
  type IExportToPostmanOptions,
} from "../../src/lib/contracts/plugin.interface";

describe("ExportToPostmanOptionsSchema — frameworkSearchRoot", () => {
  test("se acepta omitirla (es opcional)", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  test("se acepta con un valor válido", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({
      frameworkSearchRoot: "apps/api",
    });
    expect(parsed.success).toBe(true);
    expect((parsed.data as IExportToPostmanOptions).frameworkSearchRoot).toBe(
      "apps/api",
    );
  });

  test("rechaza una cadena vacía (debe apuntar a algo)", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({
      frameworkSearchRoot: "",
    });
    expect(parsed.success).toBe(false);
  });

  test("rechaza un valor que no es cadena", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({
      frameworkSearchRoot: 42,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("ExportToPostmanOptionsSchema — campos previos", () => {
  test("defaultProjectRoot sigue funcionando", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({
      defaultProjectRoot: "/srv/api",
    });
    expect(parsed.success).toBe(true);
    expect(
      (parsed.data as IExportToPostmanOptions).defaultProjectRoot,
    ).toBe("/srv/api");
  });

  test("cliScript sigue funcionando", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({
      cliScript: "/otro/cli.ts",
    });
    expect(parsed.success).toBe(true);
  });

  test("delendaiBunBin sigue funcionando", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({
      delendaiBunBin: "/usr/local/bin/bun",
    });
    expect(parsed.success).toBe(true);
  });

  test("se pueden combinar con la nueva opción", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({
      defaultProjectRoot: "/srv/api",
      frameworkSearchRoot: "apps/api",
      cliScript: "/otro/cli.ts",
    });
    expect(parsed.success).toBe(true);
    expect(
      (parsed.data as IExportToPostmanOptions).frameworkSearchRoot,
    ).toBe("apps/api");
  });
});

describe("ExportToPostmanOptionsSchema — strict", () => {
  test("rechaza un campo desconocido", () => {
    const parsed = ExportToPostmanOptionsSchema.safeParse({
      frameworkSearchRoot: "apps/api",
      noExiste: true,
    });
    expect(parsed.success).toBe(false);
  });
});