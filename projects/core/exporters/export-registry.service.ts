/**
 * El catálogo de formatos de salida.
 *
 * Un formato nuevo se añade aquí y aparece solo en `--format`, en la
 * ayuda del CLI y en los mensajes de error. Es la misma regla que con
 * los scanners: **ninguna lista paralela**. Un `enum` de formatos escrito
 * a mano se queda viejo el día que se añade el sexto, y rechazaría como
 * inválido algo que sí existe.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../contracts/export-target.interface.js";
import { BrunoExporter } from "./bruno.exporter.js";
import { CurlExporter, HarExporter } from "./har.exporter.js";
import { InsomniaExporter } from "./insomnia.exporter.js";
import { OpenApiExporter } from "./openapi.exporter.js";

/**
 * El formato por defecto, y el que no se puede quitar.
 *
 * `postman` no está en este registro: lo produce el pipeline con
 * `buildCollection`, que hace bastante más que serializar (flujo de
 * auth, aserciones, identidad de la colección). Se nombra aquí para que
 * `--format postman,openapi` funcione y para que el CLI sepa que no es
 * un formato desconocido.
 */
export const DEFAULT_FORMAT = "postman";

const TARGETS: ReadonlyArray<IExportTarget> = [
  new OpenApiExporter(),
  new InsomniaExporter(),
  new BrunoExporter(),
  new HarExporter(),
  new CurlExporter(),
];

/** Todos los formatos válidos, incluido `postman`. */
export function supportedFormats(): string[] {
  return [DEFAULT_FORMAT, ...TARGETS.map((t) => t.format)];
}

/** Una línea por formato, para la ayuda. */
export function describeFormats(): Array<{ format: string; summary: string }> {
  return [
    { format: DEFAULT_FORMAT, summary: "Postman v2.1.0 (default)" },
    ...TARGETS.map((t) => ({ format: t.format, summary: t.summary })),
  ];
}

/** El exportador de un formato, o `null` si `postman`/desconocido. */
export function exporterFor(format: string): IExportTarget | null {
  return TARGETS.find((t) => t.format === format.toLowerCase().trim()) ?? null;
}

/** Lo que devuelve el parseo de `--format`. */
export type IParsedFormats =
  | { readonly ok: true; readonly formats: string[] }
  | { readonly ok: false; readonly invalid: string[]; readonly valid: string[] };

/**
 * Interpreta `--format a,b,c`.
 *
 * Falla **antes** de escanear si algún formato no existe, y lista los
 * válidos. Descubrir un nombre mal escrito al final —tras recorrer el
 * proyecto y sin haber escrito el fichero que se pedía— no dice nada de
 * lo que ha pasado. Es la misma decisión que en `--framework`.
 */
export function parseFormats(raw: string | null | undefined): IParsedFormats {
  if (!raw || !raw.trim()) return { ok: true, formats: [DEFAULT_FORMAT] };

  const requested = raw
    .split(",")
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);
  const valid = supportedFormats();
  const invalid = requested.filter((f) => !valid.includes(f));
  if (invalid.length > 0) return { ok: false, invalid, valid };

  // Se quitan los repetidos conservando el orden que pidió quien llama.
  return { ok: true, formats: [...new Set(requested)] };
}

/**
 * Serializa el proyecto a todos los formatos pedidos.
 *
 * `postman` se salta: lo escribe el pipeline por su cuenta.
 */
export function exportTo(
  formats: ReadonlyArray<string>,
  input: IExportInput,
): IExportArtifact[] {
  const out: IExportArtifact[] = [];
  for (const format of formats) {
    const target = exporterFor(format);
    if (!target) continue;
    out.push(...target.serialize(input));
  }
  return out;
}

/**
 * Lo que los formatos pedidos **no pueden** representar.
 *
 * Se devuelve aparte de los artefactos porque no impide generarlos: el
 * fichero sale igual, solo que incompleto, y quien lo pidió tiene que
 * saberlo.
 */
export function exportWarnings(
  formats: ReadonlyArray<string>,
  input: IExportInput,
): string[] {
  const out: string[] = [];
  for (const format of formats) {
    const target = exporterFor(format);
    out.push(...(target?.warnings?.(input) ?? []));
  }
  return out;
}
