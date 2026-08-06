/**
 * Enriquece el catálogo de endpoints con variantes de body y query
 * generadas automáticamente desde los FormRequests de Laravel.
 *
 * Prioridad de resolución del FormRequest:
 *   1. Mapa explícito method+uri → ruta FormRequest (viene del discovery).
 *   2. Heurística por nombre del endpoint (`CrearUsuarioRequest`).
 *   3. Búsqueda en el índice de FormRequests del proyecto.
 *
 * Los endpoints con body declarado manualmente SÍ reciben variantes
 * adicionales (el body manual se conserva como "(base)").
 */
import type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
} from "../../core/contracts/postman.interface.js";
import type { IProjectContext } from "../../core/contracts/project-context.interface.js";
import {
  projectDirs,
  toProjectRelative as toContextRelative,
} from "../../core/discovery/project-context.service.js";
import { VARIANT_TAG } from "../../core/contracts/postman.constant.js";
import {
  generateBodyVariants,
  generateQueryVariants,
  parseFormRequest,
  type FormRequestRules,
} from "./form-request-parser.service.js";
import { requestsDir, toProjectRelative } from "../../core/discovery/paths.service.js";

export interface EnrichmentStats {
  bodyVariants: number;
  queryVariants: number;
  skippedManualBody: number;
  unresolved: number;
  resolved: number;
  rulesWithUnknown: Array<{ formRequest: string; unknown: string[] }>;
}

/** Clave method+uri normalizada → ruta relativa del FormRequest. */
export type FormRequestIndex = Map<string, string>;

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

  // Sin FormRequests que resolver no hay nada que enriquecer. Salir aquí
  // evita tocar el disco y, sobre todo, evita lanzar en proyectos que no
  // son Laravel: `requestsDir()` es `<raíz>/app/Http/Requests`, que en un
  // proyecto Express o Go no existe.
  if (formRequestByRoute.size === 0) return stats;

  const cache = new Map<string, Promise<FormRequestRules | null>>();
  async function loadFormRequest(
    relOrAbs: string,
  ): Promise<FormRequestRules | null> {
    if (cache.has(relOrAbs)) return cache.get(relOrAbs)!;
    const p = (async () => {
      try {
        const r = await parseFormRequest(relOrAbs);
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
  const requestsRootValue = context ? projectDirs(context).requests : requestsDir();
  if (!requestsRootValue) {
    // Sin raíz determinable no se puede localizar ningún FormRequest,
    // pero eso no es motivo para abortar la generación: los endpoints ya
    // tienen su body del scanner.
    stats.unresolved = formRequestByRoute.size;
    return stats;
  }
  const REQUESTS_ROOT: string = requestsRootValue;
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
      const rel = context ? toContextRelative(context, file) : toProjectRelative(file);
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
