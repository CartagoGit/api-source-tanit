/**
 * Enriches the endpoint catalog with auto-generated body and query
 * variants from Laravel's FormRequests.
 *
 * FormRequest resolution priority:
 *   1. Explicit map method+uri → FormRequest path (from discovery).
 *   2. Heuristic by endpoint name (`CreateUserRequest`).
 *   3. Search in the project's FormRequest index.
 *
 * Endpoints with a manually-declared body DO receive additional
 * variants (the manual body is kept as "(base)").
 *
 * S5 (a00012): `enrichCatalogWithFormRequests` is kept for backward
 * compatibility. The new entry point is the registry
 * (`packages/core/validation/validation-enricher.service.ts`); this
 * module exports `LARAVEL_FORM_REQUEST_ENRICHER` so `generate` can
 * register it in the bootstrap. The public function only delegates
 * to the wrapper when the endpoint's provider is Laravel; the rest
 * of the frameworks stay as they are.
 */
import type {
  EndpointSpec,
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { projectDirs, toProjectRelative as toContextRelative } from "../../core/discovery/project-context.service.js";
import { VARIANT_TAG } from "../../contracts/constants/core/postman.constant.js";
import { generateBodyVariants, generateQueryVariants, parseFormRequest } from "./form-request-parser.service.js";
import type { EnrichmentStats, FormRequestIndex } from "../../contracts/interfaces/frameworks/scanners.interface.js";
import type { FormRequestRules } from "../../contracts/interfaces/frameworks/scanners.interface.js";
import { runValidationEnrichers } from "../../core/validation/validation-enricher.service.js";

function normalizeKey(method: string, uri: string): string {
  const u = uri
    .replace(/^\{\{baseUrl\}\}/, "")
    .replace(/^\/+/, "")
    .replace(/\{\{[^}]+\}\}/g, ":p")
    .replace(/\{[^}]+\}/g, ":p");
  return `${method.toUpperCase()} ${u}`;
}

function guessNamesFromEndpoint(name: string): string[] {
  const base = name
    .replace(/\s*\(.*?\)\s*$/, "")
    .replace(/^Auto ·\s*/i, "")
    .trim();
  const camel = base
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  const guesses = new Set<string>();
  if (camel) {
    guesses.add(`${camel}Request`);
    if (/^Listar/i.test(camel)) {
      const rest = camel.replace(/^Listar/i, "");
      guesses.add(`Index${rest}Request`);
      guesses.add(`Index${rest.replace(/s$/, "")}Request`);
    }
    if (/^Crear/i.test(camel)) {
      const rest = camel.replace(/^Crear/i, "");
      guesses.add(`Store${rest}Request`);
      guesses.add(`Nuevo${rest}Request`);
      guesses.add(`Create${rest}Request`);
    }
    if (/^Actualizar|^Editar/i.test(camel)) {
      const rest = camel.replace(/^(Actualizar|Editar)/i, "");
      guesses.add(`Update${rest}Request`);
      guesses.add(`Edita${rest}Request`);
    }
    if (/^Eliminar|^Desactivar/i.test(camel)) {
      const rest = camel.replace(/^(Eliminar|Desactivar)/i, "");
      guesses.add(`Destroy${rest}Request`);
      guesses.add(`Delete${rest}Request`);
    }
    if (/^Ver/i.test(camel)) {
      const rest = camel.replace(/^Ver/i, "");
      guesses.add(`Show${rest}Request`);
    }
  }
  return [...guesses];
}

export async function enrichCatalogWithFormRequests(
  collection: PostmanCollection,
  formRequestByRoute: FormRequestIndex = new Map(),
  context?: IProjectContext,
): Promise<EnrichmentStats> {
  const stats: EnrichmentStats = {
    bodyVariants: 0,
    queryVariants: 0,
    skippedManualBody: 0,
    unresolved: 0,
    resolved: 0,
    rulesWithUnknown: [],
  };

  // Without FormRequests to resolve there is nothing to enrich. Exiting
  // here avoids touching disk and, importantly, avoids running on
  // non-Laravel projects: `requestsDir()` is `<root>/app/Http/Requests`,
  // which does not exist in an Express or Go project.
  if (formRequestByRoute.size === 0) return stats;

  const cache = new Map<string, Promise<FormRequestRules | null>>();
  async function loadFormRequest(
    relOrAbs: string,
  ): Promise<FormRequestRules | null> {
    if (cache.has(relOrAbs)) return cache.get(relOrAbs)!;
    const p = (async () => {
      try {
        const r = await parseFormRequest(relOrAbs, context!);
        if (r.isEmpty) return null;
        return r;
      } catch {
        return null;
      }
    })();
    cache.set(relOrAbs, p);
    return p;
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const REQUESTS_ROOT = projectDirs(context!).requests;
  const byClassName = new Map<string, string>();
  try {
    const entries = await fs.readdir(REQUESTS_ROOT, { recursive: true });
    for (const entry of entries) {
      if (!entry.endsWith("Request.php")) continue;
      const abs = path.resolve(REQUESTS_ROOT, entry);
      const cls = path.basename(entry, ".php");
      if (!byClassName.has(cls)) byClassName.set(cls, abs);
    }
  } catch {
    // sin requests
  }

  function findFormRequestFile(name: string): string | null {
    return byClassName.get(name) ?? null;
  }

  function buildVariantRequest(
    parent: PostmanRequest,
    variant: { name: string; body: Record<string, unknown> },
  ): PostmanRequest {
    return {
      ...parent,
      header: [
        { key: "Content-Type", value: "application/json", type: "text" },
        ...parent.header.filter((h) => h.key !== "Content-Type"),
      ],
      body: {
        mode: "raw",
        raw: JSON.stringify(variant.body, null, 2),
        options: { raw: { language: "json" } },
      },
      description: `${parent.description ?? ""}\n\n**Variante auto-generada**: ${variant.name}.`,
    };
  }

  function buildVariantWithQuery(
    parent: PostmanRequest,
    variant: {
      name: string;
      query: Array<{ key: string; value: string; description: string }>;
    },
  ): PostmanRequest {
    const existingQuery = parent.url.query ?? [];
    const newQuery = variant.query.map((q) => ({ ...q, disabled: false }));
    return {
      ...parent,
      url: {
        ...parent.url,
        query: [...existingQuery, ...newQuery],
      },
      description: `${parent.description ?? ""}\n\n**Variante auto-generada**: ${variant.name}.`,
    };
  }

  async function resolveRules(
    item: PostmanItem,
    req: PostmanRequest,
  ): Promise<FormRequestRules | null> {
    const key = normalizeKey(req.method, req.url.raw);
    const explicit = formRequestByRoute.get(key);
    if (explicit) {
      const rules = await loadFormRequest(explicit);
      if (rules) return rules;
    }

    for (const guess of guessNamesFromEndpoint(item.name)) {
      const file = findFormRequestFile(guess);
      if (!file) continue;
      const rel = toContextRelative(context!, file);
      const rules = await loadFormRequest(rel);
      if (rules) return rules;
    }

    return null;
  }

  async function enrichItem(item: PostmanItem): Promise<void> {
    if (item.item) {
      for (const child of item.item) await enrichItem(child);
      return;
    }
    const req = item.request as PostmanRequest;
    const method = req.method;
    const rules = await resolveRules(item, req);
    if (!rules) {
      stats.unresolved += 1;
      return;
    }
    stats.resolved += 1;

    if (rules.unknown.length > 0) {
      stats.rulesWithUnknown.push({
        formRequest: rules.className,
        unknown: rules.unknown
          .map((u) => `${u.field} → ${u.rule}`)
          .slice(0, 5),
      });
    }

    const hasManualBody = !!req.body;

    if (method === "GET") {
      const variants = generateQueryVariants(rules);
      if (variants.length === 0) return;
      const childItems: PostmanItem[] = variants.map((v) => ({
        name: `Variante: ${v.name}${VARIANT_TAG}`,
        request: buildVariantWithQuery(req, v),
        description: `Generada automáticamente desde ${rules.className}.`,
      }));
      const wrapper: PostmanItem = {
        name: `Variantes (auto · ${rules.className})`,
        item: childItems,
        description: `Variantes auto-generadas desde \`${rules.className}\`.`,
      };
      const folderItem: PostmanItem = {
        name: item.name,
        item: [{ name: `${item.name} (base)`, request: req }, wrapper],
      };
      Object.assign(item, folderItem);
      delete (item as { request?: PostmanRequest }).request;
      stats.queryVariants += childItems.length;
      return;
    }

    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const variants = generateBodyVariants(rules);
      if (variants.length === 0) {
        if (hasManualBody) stats.skippedManualBody += 1;
        return;
      }
      const baseItem: PostmanItem = {
        name: `${item.name} (base)`,
        request: req,
      };
      const childItems: PostmanItem[] = variants.map((v) => ({
        name: `Variante: ${v.name}${VARIANT_TAG}`,
        request: buildVariantRequest(req, v),
        description: `Generada automáticamente desde ${rules.className}.`,
      }));
      const wrapper: PostmanItem = {
        name: `Variantes (auto · ${rules.className})`,
        item: childItems,
        description: `Variantes auto-generadas desde \`${rules.className}\`.`,
      };
      const folderItem: PostmanItem = {
        name: item.name,
        item: [baseItem, wrapper],
      };
      Object.assign(item, folderItem);
      delete (item as { request?: PostmanRequest }).request;
      stats.bodyVariants += childItems.length;
      if (hasManualBody) stats.skippedManualBody += 1;
    }
  }

  for (const item of collection.item) await enrichItem(item);
  return stats;
}

/**
 * Re-export of the Laravel enricher.
 *
 * The identifier is defined in
 * `packages/contracts/constants/frameworks/laravel-form-request-enricher.constant.ts`
 * (`lint:contracts` rule: the type and instance go in `contracts/`,
 * not next to whoever uses them). This re-export preserves the path
 * `generate.script.ts` and the tests already knew: importing from
 * `catalog-enricher.service.js`. The `export { … } from` syntax
 * does not trigger `lint:contracts` because the script only looks
 * for literal `export const FOO = …` or `export const FOO: …`.
 */
export { LARAVEL_FORM_REQUEST_ENRICHER } from "../../contracts/constants/frameworks/laravel-form-request-enricher.constant.js";

/**
 * Compatibility wrapper: delegates to the registry for specs whose
 * `validationSource.provider === "laravel-form-request"`.
 *
 * If an endpoint has no `validationSource`, or its provider is not
 * registered, the wrapper lets it pass through as-is. This preserves
 * the S5 invariant: an Express/FastAPI/... project never goes
 * through the Laravel enricher even if its `validation.resolve()`
 * returns rules.
 *
 * Returns an array parallel to the input with the enriched specs;
 * those that did not touch the registry appear identical (same
 * object).
 *
 * It is NOT a substitute for `enrichCatalogWithFormRequests`: the
 * wrapper works on `EndpointSpec[]` and `runValidationEnrichers` is
 * per-spec, so the Postman variants (folder + base + variants) are
 * still produced by the legacy function. This wrapper exists so
 * that `generate` can invoke the registry without losing that
 * generation.
 */
export function enrichValidationSources(specs: ReadonlyArray<EndpointSpec>): EndpointSpec[] {
  // The registry lives in `core/validation`. Importing it statically
  // (above) already establishes the `frameworks → core` dependency,
  // which is legal: the framework depends on the core, not the other
  // way around. What we do NOT do is touch the registry here —
  // `registerValidationEnricher` lives in the `generate` bootstrap,
  // which is the one that decides which providers get loaded.
  return specs.map((spec) => runValidationEnrichers(spec));
}
