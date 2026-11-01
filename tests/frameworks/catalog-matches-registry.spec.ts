/**
 * The catalog and the registry say the same thing.
 *
 * `FRAMEWORK_IDS` lives in contracts and is a literal list; the
 * scanner registry is the one that fulfils it. That direction is
 * deliberate: deriving the list from the registry forced importing
 * the twenty-one scanners —with their PHP, Go, Java, Python and Rust
 * parsers— just to read twenty-one strings. The MCP plugin did that
 * solely to declare a `z.enum`.
 *
 * The price of inverting it is having two lists, and this repository
 * already knows how that ends: `NON_LARAVEL_FRAMEWORKS` enumerated
 * eleven of twelve frameworks, Laravel was missing, and `summary`
 * went down a different path counting declared routes instead of
 * endpoints. It said 7 where the pipeline finds 17.
 *
 * What made that list dangerous was not its existence: it was that
 * **nobody compared them**. This file is that comparison.
 */
import { describe, expect, test } from "vitest";

import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant";
import { registeredFrameworkIds } from "../../packages/frameworks/framework.registry";

describe("catalog and registry", () => {
  /** THE test: none missing and none extra, on either side. */
  test("declare exactly the same frameworks", () => {
    const catalogo = [...FRAMEWORK_IDS].sort();
    const registrados = [...registeredFrameworkIds()].sort();

    expect(registrados, "the registry has one the catalog does not declare").toEqual(
      catalogo,
    );
  });

  test("the catalog has no duplicates", () => {
    expect(new Set(FRAMEWORK_IDS).size).toBe(FRAMEWORK_IDS.length);
  });

  test("neither does the registry: two detectors with the same id would clash", () => {
    const ids = registeredFrameworkIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Alphabetical order is not aesthetic: it makes adding a framework a
   * one-line diff instead of a reordered block, and reviewing it is
   * reading a single line.
   */
  test("the catalog is in alphabetical order", () => {
    expect([...FRAMEWORK_IDS]).toEqual([...FRAMEWORK_IDS].sort());
  });

  /**
   * Reading the catalog cannot cost loading the scanners. That is the
   * whole reason for this, so it is asserted on the file text: if
   * someone adds an import to `frameworks/`, this catches it.
   */
  test("the catalog imports nothing", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const aqui = dirname(fileURLToPath(import.meta.url));
    const fuente = await readFile(
      join(
        aqui,
        "..",
        "..",
        "packages",
        "contracts",
        "constants",
        "frameworks",
        "framework-ids.constant.ts",
      ),
      "utf8",
    );
    const sinComentarios = fuente
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(sinComentarios).not.toMatch(/^import\s/m);
  });
});
