/**
 * `list-endpoints.handler.ts` — list the endpoints of a snapshot.
 *
 * Returns a flat array of `IEndpointSummary` after applying the
 * filters. Pagination is cursor-based for forward compatibility (a
 * future slice will back it with a stable key); today the cursor is
 * an offset into the filtered list.
 *
 * ## Why the summary carries so much
 *
 * It used to carry three fields: method, URI and name. Enough to
 * count, not enough to *show*. The app worked around that the only
 * way a client can: it **invented** the rest — five thousand
 * endpoints with an auth scheme, a confidence score and a source file
 * that no scanner had ever seen. The screens looked finished and were
 * showing fiction.
 *
 * The fix was not in the app. The snapshot already knew all of it:
 * the transport is on the spec, the auth is on the spec, the
 * validation source is on the spec, the inferred responses are on the
 * spec, and the declaration's file and line are on the **route** the
 * spec was built from. So the handler reads them and answers.
 *
 * The filters came for the same reason. They used to live in the app,
 * filtering invented data — a filter over fiction is decoration. Now
 * the backend answers them, and the app asks.
 */
import type { IHandler } from "./dispatcher.js";
import {
  ListEndpointsInputSchema,
  type ListEndpointsInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/endpoint-legacy.interface.js";
import type { ParsedRoute } from "../../contracts/interfaces/core/scanner.interface.js";

/** Resultado paginado de listar endpoints de un snapshot. */
import type { ListEndpointsOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { ListEndpointsOutput } from "../../contracts/interfaces/core/application-api.interface.js";

const DEFAULT_LIMIT = 100;

/** The summary the handler answers with, before it is paged. */
interface IEndpointRow {
  readonly method: string;
  readonly uri: string;
  readonly name: string;
  readonly serviceId: string;
  readonly description?: string;
  readonly folder?: string;
  readonly transport: string;
  readonly auth: string;
  readonly validation: string;
  readonly framework: string;
  readonly confidence?: string;
  readonly responses?: string[];
  readonly sourceFile?: string;
  readonly line?: number;
}

/**
 * The key a route and a spec share.
 *
 * The same operation, the same key: the URI normalized, the method
 * uppercased, and the service in the key because a monorepo can have
 * two endpoints with the same method and URI in different workspaces.
 * Without the service, the second one would steal the first one's
 * file and line.
 */
function identityKey(method: string, uri: string, serviceId: string): string {
  const normalized = uri.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${serviceId}::${method.toUpperCase()} ${normalized}`;
}

/**
 * Where each route was declared.
 *
 * The snapshot keeps the routes next to the specs, and a spec is
 * built from a route — so the declaration's file and line are there
 * to be read. When a spec came from somewhere else (an OpenAPI
 * document, a spec file), there is no route to match, and the
 * endpoint simply has no location: the UI says so rather than
 * pointing at a file that was never opened.
 */
function locationsByIdentity(
  results: ReadonlyArray<{
    readonly routes: ReadonlyArray<ParsedRoute>;
    readonly serviceId?: string;
  }>,
): Map<string, { readonly sourceFile: string; readonly line: number }> {
  const map = new Map<string, { readonly sourceFile: string; readonly line: number }>();
  for (const result of results) {
    const serviceId = result.serviceId ?? "default";
    for (const route of result.routes) {
      const key = identityKey(route.method, route.uri, serviceId);
      if (map.has(key)) continue;
      map.set(key, { sourceFile: route.sourceFile, line: route.lineNumber });
    }
  }
  return map;
}

/** The auth scheme, in the words a person would use. */
function authOf(spec: EndpointSpec): string {
  const auth = spec.auth;
  if (!auth || auth.kind === "none") return "none";
  return auth.scheme;
}

/**
 * The validation, in the words a person would use.
 *
 * The spec carries a *provider* ("laravel-form-request", "zod") and
 * a reference, not a yes/no. So the answer names the provider when
 * there is one, and says "none" when there is not — it does not
 * claim a validation exists when only a hint of one was found.
 */
function validationOf(spec: EndpointSpec): string {
  if (spec.validationSource) return spec.validationSource.provider;
  if (spec.fields && spec.fields.length > 0) return "fields";
  return "none";
}

/** The framework that recognized this result. */
function frameworkOf(result: {
  readonly match?: { readonly framework?: string } | null;
  readonly frameworks: ReadonlyArray<string>;
}): string {
  return result.match?.framework ?? result.frameworks[0] ?? "unknown";
}

/** Crea el handler paginado para consultar endpoints del snapshot actual. */
export function createListEndpointsHandler(): IHandler<ListEndpointsInput, ListEndpointsOutput> {
  return {
    name: "list-endpoints",
    input: ListEndpointsInputSchema,
    async handle(input) {
      const session = getSession(input.projectRoot);
      if (!session) {
        throw apiError(
          "SESSION_NOT_FOUND",
          `No open session for projectRoot "${input.projectRoot}"`,
        );
      }
      const snap = session.current();
      const method = input.method?.toUpperCase();
      const uriNeedle = input.uriContains;
      const limit = input.limit ?? DEFAULT_LIMIT;
      const search = input.search?.trim().toLowerCase();
      const locations = locationsByIdentity(snap.results);

      const all: IEndpointRow[] = snap.results.flatMap((r) =>
        r.specs.map((spec) => {
          const serviceId = spec.serviceId ?? r.serviceId ?? "default";
          const location = locations.get(identityKey(spec.method, spec.uri, serviceId));
          const responses = spec.responses?.map((response) => String(response.status));
          return {
            method: spec.method,
            uri: spec.uri,
            name: spec.name,
            serviceId,
            ...(spec.description !== undefined ? { description: spec.description } : {}),
            ...(spec.folder !== undefined ? { folder: spec.folder } : {}),
            transport: spec.transport ?? "http",
            auth: authOf(spec),
            validation: validationOf(spec),
            framework: frameworkOf(r),
            ...(spec.confidence !== undefined ? { confidence: spec.confidence.level } : {}),
            ...(responses !== undefined && responses.length > 0 ? { responses } : {}),
            ...(location !== undefined
              ? { sourceFile: location.sourceFile, line: location.line }
              : {}),
          };
        }),
      );

      const filtered = all.filter((e) => {
        if (method && e.method.toUpperCase() !== method) return false;
        if (uriNeedle && !e.uri.includes(uriNeedle)) return false;
        if (input.service && e.serviceId !== input.service) return false;
        if (input.transport && e.transport !== input.transport) return false;
        if (input.auth && e.auth !== input.auth) return false;
        if (input.validation && e.validation !== input.validation) return false;
        if (input.framework && e.framework !== input.framework) return false;
        if (input.confidence && e.confidence !== input.confidence) return false;
        if (input.responses && !(e.responses ?? []).some((status) => status.includes(input.responses!))) {
          return false;
        }
        if (input.sourceFile && !(e.sourceFile ?? "").includes(input.sourceFile)) {
          return false;
        }
        if (search && !`${e.method} ${e.uri} ${e.name}`.toLowerCase().includes(search)) {
          return false;
        }
        return true;
      });

      const start = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0;
      const page = filtered.slice(start, start + limit);
      const next = start + limit < filtered.length ? String(start + limit) : null;

      return {
        endpoints: page,
        nextCursor: next,
        total: filtered.length,
        indexedTotal: all.length,
      };
    },
  };
}
