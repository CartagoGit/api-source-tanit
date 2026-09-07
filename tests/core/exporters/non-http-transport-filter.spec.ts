/**
 * HTTP-only exporters skip non-http transports (f00013 S1).
 *
 * Today every catalog reaches `serialize()` of every HTTP exporter
 * verbatim. A mixed-transport project — e.g. a `.proto` gRPC
 * service plus a REST API — would have its gRPC routes rendered as
 * `POST /Greeter/SayHello` in Postman/OpenAPI/HAR/Bruno/Insomnia/cURL
 * with no metadata, which is the silent breakage `f00013` S1 fixes.
 *
 * The acceptance for S1 is:
 *   - non-http specs are filtered out of each HTTP exporter's
 *     output (no extra entries, no path collisions, no malformed
 *     verbs);
 *   - one structured warning per skipped spec per exporter is
 *     emitted through `console.warn`, so external runners can pick
 *     the dropped routes up without regexing free text.
 */
import { describe, expect, test, vi } from "vitest";

import type { EndpointSpec } from "../../../packages/contracts/interfaces/core/postman.interface";
import type { IExportInput } from "../../../packages/contracts/interfaces/core/export-target.interface";
import { BrunoExporter } from "../../../packages/core/exporters/bruno.exporter";
import { CurlExporter, HarExporter } from "../../../packages/core/exporters/har.exporter";
import { InsomniaExporter } from "../../../packages/core/exporters/insomnia.exporter";
import { OpenApiExporter } from "../../../packages/core/exporters/openapi.exporter";

function spec(
  method: EndpointSpec["method"],
  uri: string,
  extra: Partial<EndpointSpec> = {},
): EndpointSpec {
  return {
    name: `Spec ${method} ${uri}`,
    method,
    uri,
    ...extra,
  } as EndpointSpec;
}

function baseInput(specs: ReadonlyArray<EndpointSpec>): IExportInput {
  return {
    specs,
    config: {
      name: "mixed-api",
      collectionName: "Mixed API",
      collectionDescription: "",
      baseUrl: "http://localhost:3000",
      variables: [],
      filePrefixes: {},
      zones: [],
      zoneOrder: [],
      defaultZone: "Other",
      authDescriptions: {},
      loginEndpointName: "Login",
    } as IExportInput["config"],
    auth: { type: "none" },
  };
}

describe("HTTP-only exporters skip non-http transports (f00013 S1)", () => {
  test("openapi, har, bruno, insomnia and curl filter the non-http specs and warn structurally", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const input = baseInput([
        spec("GET", "/api/users", { name: "List Users" }),
        spec("POST", "/Greeter/SayHello", {
          name: "Greeter/SayHello",
          transport: "grpc",
        }),
      ]);

      const openapi = new OpenApiExporter().serialize(input)[0]!.content;
      expect(openapi).toContain("/api/users");
      expect(openapi).not.toContain("/Greeter/SayHello");

      const har = JSON.parse(new HarExporter().serialize(input)[0]!.content) as {
        log: { entries: Array<{ request: { url: string } }> };
      };
      expect(har.log.entries).toHaveLength(1);
      expect(har.log.entries[0]!.request.url).toContain("/api/users");

      const brunoArtifacts = new BrunoExporter().serialize(input);
      const brunoRequests = brunoArtifacts.filter(
        (artifact) => artifact.path.endsWith(".bru") && !artifact.path.endsWith("Local.bru"),
      );
      expect(brunoRequests).toHaveLength(1);
      expect(brunoRequests[0]!.content).toContain("/api/users");

      const insomnia = JSON.parse(new InsomniaExporter().serialize(input)[0]!.content) as {
        resources: Array<{ _type: string; url?: string }>;
      };
      const insomniaRequests = insomnia.resources.filter((resource) => resource._type === "request");
      expect(insomniaRequests).toHaveLength(1);
      expect(insomniaRequests[0]!.url).toContain("/api/users");

      const curl = new CurlExporter().serialize(input)[0]!.content;
      expect(curl).toContain("/api/users");
      expect(curl).not.toContain("/Greeter/SayHello");

      expect(warn).toHaveBeenCalledTimes(5);
      for (const call of warn.mock.calls) {
        expect(JSON.parse(String(call[0]))).toMatchObject({
          kind: "skipped-non-http-export",
          transport: "grpc",
          endpoint: "POST /Greeter/SayHello",
          name: "Greeter/SayHello",
        });
      }
    } finally {
      warn.mockRestore();
    }
  });
});
