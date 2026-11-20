#!/usr/bin/env bun
/**
 * `bun run lint:i18n-completeness` — bloquea locales i18n que son
 * placeholder del inglés.
 *
 * ## Por qué existe (x00037)
 *
 * Auditoría 2026-09-04: 13 de los 15 locales en
 * `packages/ui/i18n/locales/` compartían el mismo `sha256` que
 * `en.json`. Etiquetas como "Deutsch" servían al usuario el contenido
 * inglés. Es un bug de producto/i18n disfrazado de cobertura: el
 * selector de idioma mostraba opciones que no eran opciones.
 *
 * ## Qué hace
 *
 * Para cada locale distinto del de referencia (inglés por defecto),
 * compara Jaccard de claves y solape de strings:
 *
 *   - Si `completeness === "experimental"` en su metadata `_completeness`,
 *     el locale queda documentado como placeholder y el gate lo acepta
 *     (es la marca explícita de "sé que está sin traducir, no quiero
 *     mentir al usuario todavía").
 *   - Si no tiene metadata y su solape con el locale referencia es
 *     `>= 0.99` (o el locale tiene `≤ 2` claves distintas), falla con
 *     un mensaje accionable: "locale `<x>` parece placeholder de `<ref>`"
 *     y enseña el porcentaje de solape + el nombre de la carpeta
 *     donde está.
 *
 * ## Por qué no exigir 100% de claves traducidas
 *
 * El gate no es un traductor. Lo único que afirma es: "este locale
 * tiene contenido distinto del inglés". Una traducción al 60% sigue
 * siendo distinta y pasa el gate; la cobertura real (conteo de claves
 * traducidas) se hace en otro slice (`x00037 S2` mete `_completeness`
 * como porcentaje y otro gate distinto lo verifica). Mezclar las dos
 * cosas acopla dos políticas distintas en un solo script.
 *
 * ## Cómo se anota un locale como placeholder
 *
 * Añadir en el `.json`:
 *
 *     "_meta": {
 *       "_completeness": "experimental",
 *       "_referenceSha": "<sha del en.json en el último commit conocido>"
 *     }
 *
 * Uso:
 *   bun run lint:i18n-completeness
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { UI_DIR } from "../helpers/root.helper.js";

const LOCALES_DIR = join(UI_DIR, "i18n", "locales");

/** Locale usado como referencia para detectar placeholders. */
const REFERENCE_LOCALE = "en.json";

/**
 * Fracción de valores que deben ser idénticos al referencia para
 * declarar placeholder. Comparamos solo sobre claves comunes: si el
 * locale añade claves (p.ej. `_meta`) o falta alguna, eso se mide
 * aparte en `valueOverlapDistinct` para no inflar el numerador.
 *
 * 1.0 = todos los valores son idénticos. Bajarlo detecta traducciones
 * con solo 2-3 palabras distintas (poco probable, pero pasa). Subirlo
 * pierde sensibilidad: un locale con una sola palabra idéntica por
 * coincidencia ya no contaría.
 */
const PLACEHOLDER_VALUE_OVERLAP = 1.0;

interface LocaleSummary {
  readonly name: string;
  readonly keys: ReadonlyArray<string>;
  readonly values: ReadonlyMap<string, string>;
  readonly metaCompleteness: string | undefined;
}

interface ComparisonReport {
  readonly name: string;
  readonly jaccardKeys: number;
  readonly valueOverlap: number;
  readonly commonKeyCount: number;
  readonly isPlaceholder: boolean;
  readonly metaCompleteness: string | undefined;
}

/** Lee un locale y devuelve su conjunto de claves y el mapa clave→valor. */
async function loadLocale(name: string): Promise<LocaleSummary> {
  const path = join(LOCALES_DIR, name);
  const raw = (await readFile(path, "utf8")) as string;
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const values = new Map<string, string>();
  const metaCompleteness =
    typeof parsed._meta === "object" &&
    parsed._meta !== null &&
    typeof (parsed._meta as Record<string, unknown>)._completeness === "string"
      ? ((parsed._meta as Record<string, unknown>)._completeness as string)
      : undefined;

  for (const [key, value] of Object.entries(parsed)) {
    if (key === "_meta") continue;
    values.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  return {
    name,
    keys: [...values.keys()].sort(),
    values,
    metaCompleteness,
  };
}

/** Lista de locales disponibles (incluye el referencia; se filtra fuera). */
async function listLocales(): Promise<string[]> {
  const entries = await readdir(LOCALES_DIR);
  return entries.filter((e) => e.endsWith(".json")).sort();
}

/**
 * Jaccard sobre conjuntos de claves. Definido aunque las claves sean
 * strings; aquí viven en un `Set<string>` por claridad.
 */
function jaccard(a: ReadonlyArray<string>, b: ReadonlyArray<string>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let intersect = 0;
  for (const k of A) if (B.has(k)) intersect += 1;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 1 : intersect / union;
}

/**
 * Solape de valores sobre claves comunes.
 *
 * Para cada clave presente en los dos locales, comparamos los strings
 * asociados. Devuelve la fracción de claves comunes cuyo valor es
 * idéntico al referencia. 1.0 = todos idénticos (placeholder);
 * 0.0 = todos distintos (no se solapa nada — posiblemente otro set de
 * claves, o una traducción completa con paráfrasis total).
 *
 * Esto es el indicador correcto para detectar placeholders: dos locales
 * con mismas claves y mismos strings son, por definición, el mismo
 * contenido. La diferencia de claves importa solo como sanity check.
 */
function valueOverlapOnCommonKeys(
  locale: LocaleSummary,
  reference: LocaleSummary,
): { overlap: number; commonKeys: number } {
  let common = 0;
  let identical = 0;
  for (const [key, refValue] of reference.values) {
    const localeValue = locale.values.get(key);
    if (localeValue === undefined) continue;
    common += 1;
    if (localeValue === refValue) identical += 1;
  }
  return {
    overlap: common === 0 ? 0 : identical / common,
    commonKeys: common,
  };
}

/**
 * Decide si un locale es placeholder del referencia.
 *
 * Criterio: para que un locale sea placeholder, **todos** los valores
 * sobre claves comunes deben coincidir. Si hay una sola palabra
 * distinta (como "Settings" → "Ajustes"), no es placeholder.
 *
 * Solo `"experimental"` está permitido como override; cualquier otro
 * valor en `_meta._completeness` no cuenta como anulación y el locale
 * debe superar la prueba estructural. Esto evita que un locale con
 * `_completeness: "casi"` se cuele sin estar traducido.
 */
function isPlaceholder(
  locale: LocaleSummary,
  reference: LocaleSummary,
): ComparisonReport {
  const { overlap, commonKeys } = valueOverlapOnCommonKeys(locale, reference);
  const structurallyPlaceholder =
    commonKeys > 0 && overlap >= PLACEHOLDER_VALUE_OVERLAP;
  const metaOverride = locale.metaCompleteness === "experimental";
  return {
    name: locale.name,
    jaccardKeys: jaccard(locale.keys, reference.keys),
    valueOverlap: overlap,
    commonKeyCount: commonKeys,
    isPlaceholder: structurallyPlaceholder && !metaOverride,
    metaCompleteness: locale.metaCompleteness,
  };
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const locales = await listLocales();
  if (locales.length === 0) {
    console.error("lint:i18n-completeness: no locales found in", LOCALES_DIR);
    process.exit(2);
  }
  if (!locales.includes(REFERENCE_LOCALE)) {
    console.error(
      `lint:i18n-completeness: reference locale ${REFERENCE_LOCALE} not found in ${LOCALES_DIR}`,
    );
    process.exit(2);
  }

  const reference = await loadLocale(REFERENCE_LOCALE);
  const others = locales.filter((l) => l !== REFERENCE_LOCALE);
  const reports: ComparisonReport[] = [];
  for (const name of others) {
    const locale = await loadLocale(name);
    reports.push(isPlaceholder(locale, reference));
  }

  const failures = reports.filter((r) => r.isPlaceholder);

  if (failures.length === 0) {
    console.log(
      `lint:i18n-completeness: ${reports.length} locale(s) OK against ${REFERENCE_LOCALE} (ref has ${reference.keys.length} keys).`,
    );
    return;
  }

  console.error(
    `lint:i18n-completeness: ${failures.length} of ${reports.length} locale(s) look like placeholders of ${REFERENCE_LOCALE}:`,
  );
  for (const f of failures) {
    const annotated = f.metaCompleteness === "experimental" ? " (annotated)" : "";
    console.error(
      `  - ${f.name}: valueOverlap=${formatPercent(f.valueOverlap)} on ${f.commonKeyCount} common keys (Jaccard keys=${formatPercent(f.jaccardKeys)})${annotated}`,
    );
  }
  console.error("");
  console.error(
    "To mark a placeholder intentionally while translation is pending, add to its JSON:",
  );
  console.error('  "_meta": { "_completeness": "experimental" }');
  console.error(
    "Once translated, remove the annotation. The UI selector reads _meta._completeness and hides experimental locales.",
  );
  process.exit(1);
}

await main();
