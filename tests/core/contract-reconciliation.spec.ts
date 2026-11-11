import { describe, expect, test } from "vitest";
import type { IContractScan } from "../../packages/contracts/interfaces/core/contract-evidence.interface.js";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/endpoint-legacy.interface.js";
import { ContractEvidenceReportSchema } from "../../packages/contracts/constants/core/contract-evidence.constant.js";
import { reconcileContracts } from "../../packages/core/discovery/contract-reconciliation.service.js";

function scan(kind: "code" | "documentation", path = "/users/{{id}}", completeness: "complete" | "partial" | "unknown" = "unknown", overrides: Partial<EndpointSpec> = {}): IContractScan {
  return {
    source: { kind, completeness, framework: kind === "code" ? "custom-code" : "custom-docs", serviceId: "api", artifacts: [kind + ".json"], limitations: [] },
    specs: [{ name: "users", method: "GET", uri: path, ...overrides }],
    routes: [{ method: "GET", uri: path, rawUri: path, sourceFile: kind + ".json", lineNumber: 12, prefixChain: [] }],
  };
}

describe("shared static contract reconciliation", () => {
  test("does not create a comparison without a documentation source", () => {
    expect(reconcileContracts([scan("code")])).toBeUndefined();
  });
  test("matches representations while retaining both source files and descriptions", () => {
    const result = reconcileContracts([scan("code", "/users/:id", "unknown", { description: "Observed description" }), scan("documentation", "/users/{id}", "partial", { description: "Documented description" })]);
    expect(result?.operations[0]).toMatchObject({ status: "matched", path: "/users/{id}", observed: [{ file: "code.json", line: 12, description: "Observed description" }], documented: [{ file: "documentation.json", description: "Documented description" }] });
    expect(result?.operations[0]?.limitations).not.toHaveLength(0);
    expect(ContractEvidenceReportSchema.parse(result)).toEqual(result);
  });
  test.each(["partial", "unknown"] as const)("does not infer absence from a %s code scanner", completeness => {
    const empty = { ...scan("code", "/missing", completeness), specs: [], routes: [] };
    expect(reconcileContracts([empty, scan("documentation")])?.operations[0]?.status).toBe("unknown");
  });
  test("only calls an operation documented-only when every code scanner declares coverage complete", () => {
    const empty = { ...scan("code", "/missing", "complete"), specs: [], routes: [] };
    expect(reconcileContracts([empty, scan("documentation")])?.operations[0]?.status).toBe("documented-only");
    expect(reconcileContracts([empty, { ...empty, source: { ...empty.source, completeness: "unknown" } }, scan("documentation")])?.operations[0]?.status).toBe("unknown");
  });
  test("only calls an operation observed-only with complete documentation coverage", () => {
    const empty = { ...scan("documentation", "/missing", "complete"), specs: [], routes: [] };
    expect(reconcileContracts([scan("code"), empty])?.operations[0]?.status).toBe("observed-only");
  });
  test("documentation without any code scanner remains unknown", () => {
    expect(reconcileContracts([scan("documentation", "/users", "complete")])?.operations[0]?.status).toBe("unknown");
  });
  test("does not rename path parameters or merge different services", () => {
    const code = scan("code", "/users/:other", "complete");
    expect(reconcileContracts([code, scan("documentation", "/users/{id}", "complete")])?.operations).toHaveLength(2);
    const differentService = { ...code, source: { ...code.source, serviceId: "other-api" } };
    const result = reconcileContracts([differentService, scan("documentation", "/users/:other", "complete")]);
    expect(result?.operations).toHaveLength(2);
    expect(result?.operations.every(item => item.status === "unknown")).toBe(true);
  });
  test("records incompatible known field assertions before merging without changing either input", () => {
    const code = scan("code", "/users", "complete", { fields: [{ fieldName: "name", location: "body", type: "integer", required: true }] });
    const doc = scan("documentation", "/users", "complete", { fields: [{ fieldName: "name", location: "body", type: "string", required: true }] });
    const before = JSON.stringify([code, doc]);
    expect(reconcileContracts([code, doc])?.operations[0]).toMatchObject({ status: "conflict", conflicts: [{ field: "body.name.type", documented: "string", observed: "integer" }] });
    expect(JSON.stringify([code, doc])).toBe(before);
  });
  test("compatible numeric refinements and absent validation do not invent conflicts", () => {
    const code = scan("code", "/users", "complete", { fields: [{ fieldName: "age", location: "body", type: "integer", required: true }] });
    const doc = scan("documentation", "/users", "complete", { fields: [{ fieldName: "age", location: "body", type: "number", required: true }] });
    expect(reconcileContracts([code, doc])?.operations[0]?.status).toBe("matched");
    expect(reconcileContracts([scan("code", "/users"), doc])?.operations[0]?.conflicts).toEqual([]);
  });
});
