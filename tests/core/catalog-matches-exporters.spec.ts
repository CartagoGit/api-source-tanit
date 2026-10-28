/**
 * The format catalog and the exporter registry say the same thing.
 *
 * Twin of `catalog-matches-registry.spec.ts`, and for the same reason:
 * `EXPORT_FORMATS` lives in contracts as a literal list so reading six
 * names does not cost loading the five exporters with their OpenAPI,
 * Insomnia, Bruno, HAR, and cURL serializers. The MCP plugin used to
 * do that just to declare a `z.enum`.
 *
 * Inverting the dependency leaves two lists, and a parallel list with
 * no one to compare it against is exactly how `NON_LARAVEL_FRAMEWORKS`
 * sent Laravel down a different path for months. This is the comparison.
 */
import { describe, expect, test } from "vitest";

import {
  DEFAULT_EXPORT_FORMAT,
  EXPORT_FORMATS,
  EXPORTER_FORMATS,
} from "../../packages/contracts/constants/core/export-formats.constant";
import { registeredFormats } from "../../packages/core/exporters/export-registry.service";

describe("the format catalog and the registry", () => {
  /** THE test: none missing, none extra. */
  test("declare exactly the same formats", () => {
    expect([...registeredFormats()].sort()).toEqual([...EXPORT_FORMATS].sort());
  });

  /**
   * `postman` is not produced by any exporter: it is built by the
   * pipeline, which does much more than serialize. If it appeared in
   * the exporter list, someone would have added a serializer competing
   * with `buildCollection` and losing the auth flow and assertions.
   */
  test("`postman` is in the catalog but not among the exporters", () => {
    expect(EXPORT_FORMATS).toContain(DEFAULT_EXPORT_FORMAT);
    expect(EXPORTER_FORMATS as ReadonlyArray<string>).not.toContain(
      DEFAULT_EXPORT_FORMAT,
    );
  });

  test("the default format comes first, which is the help order", () => {
    expect(EXPORT_FORMATS[0]).toBe(DEFAULT_EXPORT_FORMAT);
  });

  test("none is repeated", () => {
    expect(new Set(EXPORT_FORMATS).size).toBe(EXPORT_FORMATS.length);
  });
});
