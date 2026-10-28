/**
 * Postman as a universal exporter.
 *
 * The collection is no longer a special output of discovery: it is the
 * artifact of one exporter selected from the same registry as OpenAPI,
 * Bruno, HAR, Insomnia and cURL.
 */
import { describe, expect, test } from "vitest";

import type {
  AuthSchemeType,
  IGenerationResult,
} from "../../../packages/contracts/interfaces/core/discovery.interface.js";
import type { EndpointSpec } from "../../../packages/contracts/interfaces/core/endpoint-legacy.interface.js";
import type { IProjectSnapshot } from "../../../packages/contracts/interfaces/core/session.interface.js";
import type {
  PostmanCollection,
  PostmanItem,
} from "../../../packages/contracts/interfaces/core/postman.interface.js";
import type { ProjectConfig } from "../../../packages/contracts/interfaces/core/project-config.interface.js";
import { buildCollection } from "../../../packages/core/domain/collection-builder.service.js";
import { PostmanExporter } from "../../../packages/core/exporters/postman.exporter.js";

interface IResultOptions {
  readonly serviceId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly authType?: AuthSchemeType;
  readonly variables?: ProjectConfig["variables"];
}

/** Builds a project configuration with no host-specific extras. */
function projectConfig(
  name: string,
  baseUrl: string,
  variables: ProjectConfig["variables"] = [],
): ProjectConfig {
  return {
    name,
    collectionName: name,
    collectionDescription: `Collection for ${name}`,
    baseUrl,
    variables,
    filePrefixes: {},
    zones: [],
    zoneOrder: [],
    defaultZone: "Other",
    authDescriptions: {},
    loginEndpointName: "Login",
  };
}

/** Builds the discovery result consumed by the exporter snapshot. */
function generationResult(options: IResultOptions): IGenerationResult {
  const config = projectConfig(
    options.name,
    options.baseUrl,
    options.variables ?? [],
  );
  const authType = options.authType ?? "none";
  const authScheme = {
    type: authType,
    evidence: "postman universal test",
  };
  const collection = buildCollection(
    [...options.specs],
    config,
    authScheme,
  );

  return {
    collection,
    specs: options.specs,
    routes: [],
    config,
    match: null,
    serviceId: options.serviceId,
    origin: "scanner",
    authFlow: null,
    authScheme,
    context: {
      projectRoot: `/tmp/${options.name}`,
      packageRoot: "/tmp/tanit",
      projectBasename: options.name,
      outputDir: `/tmp/${options.name}/tanit`,
    },
    warnings: [],
    frameworks: ["express"],
    project: {
      zeroConfig: true,
      configPath: "<zero-config>",
      manualEndpoints: 0,
    },
    metrics: {
      routes: options.specs.length,
      specs: options.specs.length,
      withValidation: 0,
      withoutValidation: options.specs.length,
      bodiesInferred: 0,
      queriesInferred: 0,
      responsesInferred: 0,
    },
  };
}

/** Builds the session snapshot consumed by `IExporter.build`. */
function snapshot(
  results: ReadonlyArray<IGenerationResult>,
): IProjectSnapshot {
  return {
    sessionId: "postman-universal-test",
    projectRoot: "/tmp/project",
    capturedAt: new Date("2026-01-01T00:00:00.000Z"),
    results,
    diagnostics: [],
    frameworks: ["express"],
  };
}

/** Returns every request in a Postman item tree. */
function requests(items: ReadonlyArray<PostmanItem>): PostmanItem[] {
  const found: PostmanItem[] = [];
  for (const item of items) {
    if (item.request !== undefined) found.push(item);
    if (item.item !== undefined) found.push(...requests(item.item));
  }
  return found;
}

describe("PostmanExporter", () => {
  test("builds an empty collection from an empty snapshot", async () => {
    const result = await new PostmanExporter().build(snapshot([]));

    expect(result.format).toBe("postman");
    expect(result.artifact).toBeDefined();
    expect(result.artifact?.item).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  test("builds one request from one operation", async () => {
    const discovery = generationResult({
      serviceId: "users",
      name: "users",
      baseUrl: "https://users.example.com",
      specs: [
        {
          name: "List users",
          method: "GET",
          uri: "/users",
        },
      ],
      variables: [{ key: "baseUrl", value: "https://users.example.com" }],
    });
    const result = await new PostmanExporter().build(
      snapshot([
        {
          ...discovery,
          collection: { ...discovery.collection, item: [] },
        },
      ]),
    );

    const collection = result.artifact;
    expect(collection).toBeDefined();
    const emitted = requests(collection?.item ?? []);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.request?.url.raw).toBe("{{baseUrl}}/users");
  });

  test("keeps each service on its own base URL in a multi-service snapshot", async () => {
    const result = await new PostmanExporter().build(
      snapshot([
        generationResult({
          serviceId: "users",
          name: "users",
          baseUrl: "https://users.example.com",
          authType: "oauth2",
          specs: [
            {
              name: "List users",
              method: "GET",
              uri: "/users",
            },
          ],
          variables: [{ key: "baseUrl", value: "https://users.example.com" }],
        }),
        generationResult({
          serviceId: "billing",
          name: "billing",
          baseUrl: "https://billing.example.com",
          authType: "bearer",
          specs: [
            {
              name: "List invoices",
              method: "GET",
              uri: "/invoices",
            },
          ],
          variables: [
            { key: "baseUrl", value: "https://billing.example.com" },
          ],
        }),
      ]),
    );

    const collection = result.artifact as PostmanCollection;
    expect(collection.variable).toEqual(
      expect.arrayContaining([
        { key: "baseUrl_users", value: "https://users.example.com" },
        { key: "baseUrl_billing", value: "https://billing.example.com" },
      ]),
    );
    const urls = requests(collection.item).map(
      (item) => item.request?.url.raw ?? "",
    );
    expect(urls).toEqual(
      expect.arrayContaining([
        "{{baseUrl_users}}/users",
        "{{baseUrl_billing}}/invoices",
      ]),
    );
    expect(urls.some((url) => url.includes("{{baseUrl}}"))).toBe(false);
  });

  test("does not collapse divergent per-operation server and auth refs", async () => {
    const discovery = generationResult({
      serviceId: "users",
      name: "universal",
      baseUrl: "https://users.example.com",
      authType: "oauth2",
      specs: [
        {
          serviceId: "users",
          name: "List users",
          method: "GET",
          uri: "/users",
          serverRef: {
            id: { kind: "server", value: "users" },
            url: "https://users.example.com",
          },
          authRef: {
            id: { kind: "auth", value: "users" },
            type: "oauth2",
          },
        },
        {
          serviceId: "billing",
          name: "List invoices",
          method: "GET",
          uri: "/invoices",
          serverRef: {
            id: { kind: "server", value: "billing" },
            url: "https://billing.example.com",
          },
          authRef: {
            id: { kind: "auth", value: "billing" },
            type: "bearer",
          },
        },
      ],
      variables: [
        { key: "baseUrl_users", value: "https://users.example.com" },
        { key: "baseUrl_billing", value: "https://billing.example.com" },
      ],
    });
    const result = await new PostmanExporter().build(
      snapshot([
        {
          ...discovery,
          collection: { ...discovery.collection, item: [] },
        },
      ]),
    );

    const collection = result.artifact as PostmanCollection;
    const emitted = requests(collection.item);
    const users = emitted.find((item) => item.name === "List users");
    const billing = emitted.find((item) => item.name === "List invoices");
    expect(users?.request?.url.raw).toBe("{{baseUrl_users}}/users");
    expect(billing?.request?.url.raw).toBe("{{baseUrl_billing}}/invoices");
    expect(
      billing?.request?.header.some(
        (header) =>
          header.key === "Authorization" &&
          header.value === "Bearer {{token}}",
      ),
    ).toBe(true);
    expect(new PostmanExporter().capabilities.auth).toBe("partial");
  });
});
