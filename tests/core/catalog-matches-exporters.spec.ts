/**
 * El catálogo de formatos y el registro de exportadores dicen lo mismo.
 *
 * Gemelo de `catalog-matches-registry.spec.ts`, y por el mismo motivo:
 * `EXPORT_FORMATS` vive en contratos como lista literal para que leer
 * seis nombres no cueste cargar los cinco exportadores con sus
 * serializadores de OpenAPI, Insomnia, Bruno, HAR y cURL. El plugin MCP
 * lo hacía solo para declarar un `z.enum`.
 *
 * Invertir la dependencia deja dos listas, y una lista paralela sin
 * nadie que la compare es exactamente cómo `NON_LARAVEL_FRAMEWORKS`
 * mandó a Laravel por un camino distinto durante meses. Esta es la
 * comparación.
 */
import { describe, expect, test } from "vitest";

import {
  DEFAULT_EXPORT_FORMAT,
  EXPORT_FORMATS,
  EXPORTER_FORMATS,
} from "../../packages/contracts/constants/core/export-formats.constant";
import { registeredFormats } from "../../packages/core/exporters/export-registry.service";

describe("el catálogo de formatos y el registro", () => {
  /** EL test: ni sobra ni falta ninguno. */
  test("declaran exactamente los mismos formatos", () => {
    expect([...registeredFormats()].sort()).toEqual([...EXPORT_FORMATS].sort());
  });

  /**
   * `postman` no lo produce ningún exportador: lo construye el pipeline,
   * que hace bastante más que serializar. Si apareciera en la lista de
   * exportadores, alguien habría añadido un serializador que compite con
   * `buildCollection` y pierde el flujo de auth y las aserciones.
   */
  test("`postman` está en el catálogo pero no entre los exportadores", () => {
    expect(EXPORT_FORMATS).toContain(DEFAULT_EXPORT_FORMAT);
    expect(EXPORTER_FORMATS as ReadonlyArray<string>).not.toContain(
      DEFAULT_EXPORT_FORMAT,
    );
  });

  test("el formato por defecto va el primero, que es el orden de la ayuda", () => {
    expect(EXPORT_FORMATS[0]).toBe(DEFAULT_EXPORT_FORMAT);
  });

  test("ninguno se repite", () => {
    expect(new Set(EXPORT_FORMATS).size).toBe(EXPORT_FORMATS.length);
  });
});
