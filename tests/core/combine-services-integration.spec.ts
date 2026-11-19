/**
 * r00019 S3 — the multi-service fixture, loaded from disk and merged.
 *
 * The unit spec (`combine-services.spec.ts`) builds its descriptors by
 * hand: it proves the merge logic, but not the fixtures. This spec
 * closes the other half. It reads the REAL fixture under
 * `tests/fixtures/multi-service/` — the NestJS users API (OAuth2 on
 * `https://users.example.com`) and the FastAPI billing API (API key
 * on `https://billing.example.com`) — and pushes it through the same
 * chain the product uses:
 *
 *   fixture on disk
 *     → discovery-side node (`IServiceGraphNode`, the legacy shape)
 *     → adapter (`toServiceDescriptor`, the public bridge)
 *     → canonical descriptors (`IServiceDescriptor`)
 *     → `combineServices` + `perOperationResolver`
 *
 * What it pins:
 *
 *   1. The fixture really carries two hosts and two auth schemes
 *      (OAuth2 for users, API key for billing). If someone strips the
 *      identity out of the fixture, this fails before the merge.
 *   2. The routes really come from the fixture's source code, so a
 *      fixture that stops being scannable fails here too.
 *   3. Every operation keeps the server and the auth of the service it
 *      came from: nobody inherits the first service's context.
 *   4. The combined descriptor publishes one `baseUrl_<serviceId>`
 *      variable per service.
 *   5. The legacy graph node and the canonical descriptor agree: the
 *      adapter is the only thing standing between them.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { SUPPORTED_METHODS } from "../../packages/contracts/constants/core/postman.constant.js";
import type { IOperation } from "../../packages/contracts/interfaces/core/operation.interface.js";
import type {
  ICombinedDescriptor,
  IServiceDescriptor,
  IServiceDescriptorAdapter,
} from "../../packages/contracts/interfaces/core/service.interface.js";
import type { IServiceGraphNode } from "../../packages/contracts/interfaces/core/service-graph.interface.js";
import type { HttpMethod } from "../../packages/contracts/interfaces/core/transport/index.js";
import { moduleDir } from "../../packages/core/helpers/module-path.helper.js";
import {
  parseJson,
  readObject,
  readString,
} from "../../packages/core/helpers/parse-json.helper.js";
import { combineServices } from "../../packages/core/merge/combine-services.service.js";
import { perOperationResolver } from "../../packages/core/merge/per-operation-resolver.service.js";
import { toServiceDescriptor } from "../../packages/core/merge/service-descriptor.adapter.js";
import { operationIdFor } from "../../packages/core/transport/operation-id.service.js";

const FIXTURE_ROOT = join(
  moduleDir(import.meta.url),
  "..",
  "fixtures",
  "multi-service",
);

type FixtureAuthScheme = "oauth2" | "apiKey" | "bearer";

interface IRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationName: string;
}

interface IFixtureService {
  readonly serviceId: string;
  readonly baseUrl: string;
  readonly authScheme: FixtureAuthScheme;
  readonly routes: ReadonlyArray<IRoute>;
  readonly sourceFile: string;
}

/** Narrows a method read from the fixture source to the supported ones. */
function toHttpMethod(raw: string): HttpMethod {
  const found = SUPPORTED_METHODS.find((method) => method === raw);
  if (found === undefined) {
    throw new Error(`Unsupported HTTP method in the fixture: ${raw}`);
  }
  return found;
}

/** Narrows an auth scheme read from the fixture to the known ones. */
function toAuthScheme(raw: string): FixtureAuthScheme {
  if (raw === "oauth2" || raw === "apiKey" || raw === "bearer") return raw;
  throw new Error(`Unsupported auth scheme in the fixture: ${raw}`);
}

/**
 * Routes of the NestJS fixture: the controller prefix plus every
 * method decorator. The handler name is read too, so the operation
 * ids look like the ones the pipeline builds.
 */
function nestJsRoutes(source: string): ReadonlyArray<IRoute> {
  const rawPrefix = /@Controller\(\s*["']([^"']*)["']\s*\)/.exec(source)?.[1] ?? "";
  const prefix = rawPrefix.length === 0 ? "" : `/${rawPrefix.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  const decorator =
    /@(Get|Post|Put|Patch|Delete)\(\s*(?:["']([^"']*)["'])?\s*\)[\s\S]*?\n\s*(?:async\s+)?(\w+)\s*\(/g;
  const routes: IRoute[] = [];
  for (const match of source.matchAll(decorator)) {
    const suffix = match[2] ?? "";
    routes.push({
      method: toHttpMethod((match[1] ?? "").toUpperCase()),
      path: suffix.length === 0 ? prefix : `${prefix}/${suffix}`,
      operationName: match[3] ?? "",
    });
  }
  return routes;
}

/** Routes of the FastAPI fixture: every `@app.<method>` decorator. */
function fastApiRoutes(source: string): ReadonlyArray<IRoute> {
  const decorator =
    /@app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["'][\s\S]*?\n\s*def\s+(\w+)/g;
  const routes: IRoute[] = [];
  for (const match of source.matchAll(decorator)) {
    routes.push({
      method: toHttpMethod((match[1] ?? "").toUpperCase()),
      path: match[2] ?? "",
      operationName: match[3] ?? "",
    });
  }
  return routes;
}

/**
 * The NestJS half of the fixture: its identity comes from the
 * `tanit` block of `package.json`, the routes from `src/main.ts`.
 */
async function loadUsersFixture(): Promise<IFixtureService> {
  const raw = await readFile(
    join(FIXTURE_ROOT, "users-api", "package.json"),
    "utf8",
  );
  const parsed = parseJson(raw);
  if (!parsed.ok) {
    throw new Error(`users-api/package.json is not valid JSON: ${parsed.reason}`);
  }
  const tanit = readObject(parsed.value, "tanit");
  const serviceId = readString(tanit, "serviceId");
  const baseUrl = readString(tanit, "baseUrl");
  const auth = readObject(tanit, "auth");
  const scheme = readString(auth, "scheme");
  if (!serviceId || !baseUrl || !scheme) {
    throw new Error("users-api fixture lost its identity (serviceId/baseUrl/auth)");
  }
  const source = await readFile(
    join(FIXTURE_ROOT, "users-api", "src", "main.ts"),
    "utf8",
  );
  return {
    serviceId,
    baseUrl,
    authScheme: toAuthScheme(scheme),
    routes: nestJsRoutes(source),
    sourceFile: "users-api/src/main.ts",
  };
}

/**
 * The FastAPI half of the fixture: its identity comes from the
 * `[tool.tanit]` block of `pyproject.toml`, the routes from `main.py`.
 */
async function loadBillingFixture(): Promise<IFixtureService> {
  const raw = await readFile(
    join(FIXTURE_ROOT, "billing-api", "pyproject.toml"),
    "utf8",
  );
  const section = /\[tool\.tanit\]([\s\S]*?)(?:\n\[|$)/.exec(raw)?.[1] ?? "";
  const serviceId = /service_id\s*=\s*["']([^"']+)["']/.exec(section)?.[1];
  const baseUrl = /base_url\s*=\s*["']([^"']+)["']/.exec(section)?.[1];
  const scheme = /auth_kind\s*=\s*["']([^"']+)["']/.exec(section)?.[1];
  if (!serviceId || !baseUrl || !scheme) {
    throw new Error("billing-api fixture lost its identity (service_id/base_url/auth_kind)");
  }
  const source = await readFile(
    join(FIXTURE_ROOT, "billing-api", "main.py"),
    "utf8",
  );
  return {
    serviceId,
    baseUrl,
    authScheme: toAuthScheme(scheme),
    routes: fastApiRoutes(source),
    sourceFile: "billing-api/main.py",
  };
}

/**
 * The discovery-side node the legacy graph produces for a service.
 * `toServiceDescriptor` turns it into the canonical descriptor.
 */
function graphNodeFor(service: IFixtureService): IServiceGraphNode {
  return {
    serviceId: service.serviceId,
    match: {
      framework: "unknown",
      projectRoot: FIXTURE_ROOT,
      frameworkSearchRoot: service.serviceId,
      artifacts: [],
    },
    additionalMatches: [],
    frameworks: [],
    endpoints: [],
    baseUrl: service.baseUrl,
    auth: { kind: "scheme", scheme: service.authScheme },
    variables: [],
  };
}

/** An operation as the scanner would hand it over: no context yet. */
function operationFor(service: IFixtureService, route: IRoute): IOperation {
  const transport = {
    kind: "http" as const,
    method: route.method,
    path: route.path,
  };
  return {
    id: operationIdFor(transport, {
      serviceId: service.serviceId,
      operationName: route.operationName,
    }),
    serviceId: service.serviceId,
    transport,
    serverRef: { id: { kind: "server", value: "pending" }, url: "pending" },
    authRef: { id: { kind: "auth", value: "pending" }, type: "none" },
    request: {},
    responses: [],
    provenance: { sourceFile: service.sourceFile },
  };
}

/**
 * The bridge between the legacy graph and the canonical descriptor,
 * typed as the public contract. If the adapter stops satisfying it,
 * this line stops compiling — which is the point.
 */
const adapt: IServiceDescriptorAdapter<IServiceGraphNode> = toServiceDescriptor;

async function loadFixtureServices(): Promise<ReadonlyArray<IFixtureService>> {
  return [await loadUsersFixture(), await loadBillingFixture()];
}

function descriptorsFor(
  services: ReadonlyArray<IFixtureService>,
): ReadonlyArray<IServiceDescriptor> {
  return services.map((service) =>
    adapt(
      graphNodeFor(service),
      service.routes.map((route) => operationFor(service, route)),
    ),
  );
}

describe("r00019 S3 — multi-service fixture on disk, merged", () => {
  test("the fixture carries two hosts and two auth schemes", async () => {
    const [users, billing] = await loadFixtureServices();

    expect(users?.serviceId).toBe("users");
    expect(users?.baseUrl).toBe("https://users.example.com");
    expect(users?.authScheme).toBe("oauth2");

    expect(billing?.serviceId).toBe("billing");
    expect(billing?.baseUrl).toBe("https://billing.example.com");
    expect(billing?.authScheme).toBe("apiKey");
  });

  test("the routes come from the fixture's own source code", async () => {
    const [users, billing] = await loadFixtureServices();

    expect(users?.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /api/users",
      "POST /api/users",
      "GET /api/users/:id",
    ]);
    expect(billing?.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /api/invoices",
      "POST /api/invoices",
      "GET /api/invoices/{invoice_id}",
    ]);
  });

  test("every operation keeps the server and the auth of its own service", async () => {
    const services = await loadFixtureServices();
    const descriptors = descriptorsFor(services);
    const combined: ICombinedDescriptor = combineServices(descriptors);

    expect(combined.operations.length).toBe(6);

    for (const operation of combined.operations) {
      const service = services.find((candidate) => candidate.serviceId === operation.serviceId);
      expect(service, `service ${operation.serviceId} exists`).toBeDefined();
      expect(operation.serverRef.url).toBe(service?.baseUrl);
      expect(operation.authRef.type).toBe(service?.authScheme);
    }

    // The bug this fixture exists for: the second service inheriting
    // the first one's host and credentials.
    const billingOperations = combined.operations.filter(
      (operation) => operation.serviceId === "billing",
    );
    expect(billingOperations.length).toBe(3);
    for (const operation of billingOperations) {
      expect(operation.serverRef.url).toBe("https://billing.example.com");
      expect(operation.serverRef.url).not.toBe("https://users.example.com");
      expect(operation.authRef.type).toBe("apiKey");
      expect(operation.authRef.type).not.toBe("oauth2");
    }
  });

  test("the combined descriptor publishes one baseUrl variable per service", async () => {
    const services = await loadFixtureServices();
    const combined = combineServices(descriptorsFor(services));

    expect(combined.variables).toEqual([
      { key: "baseUrl_users", value: "https://users.example.com" },
      { key: "baseUrl_billing", value: "https://billing.example.com" },
    ]);
  });

  test("the per-operation resolver agrees with the combined descriptor", async () => {
    const services = await loadFixtureServices();
    const descriptors = descriptorsFor(services);
    const combined = combineServices(descriptors);

    for (const operation of combined.operations) {
      const resolved = perOperationResolver.resolve(operation, descriptors);
      expect(resolved.serverRef.url).toBe(operation.serverRef.url);
      expect(resolved.authRef.type).toBe(operation.authRef.type);
    }
  });

  test("the legacy graph node and the canonical descriptor carry the same context", async () => {
    const services = await loadFixtureServices();
    const descriptors = descriptorsFor(services);

    for (const [index, service] of services.entries()) {
      const descriptor = descriptors[index];
      expect(descriptor?.id).toBe(service.serviceId);
      expect(descriptor?.baseUrl).toBe(service.baseUrl);
      expect(descriptor?.auth).toEqual({
        kind: "scheme",
        scheme: service.authScheme,
      });
      expect(descriptor?.endpoints.length).toBe(service.routes.length);
    }
  });
});
