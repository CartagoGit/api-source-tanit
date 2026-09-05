/**
 * The assertions each request carries.
 *
 * The rule that governs this: **assert nothing that is not known**. A
 * false assertion is worse than none, because it fails red and sends
 * someone to investigate a problem that does not exist.
 */
import { describe, expect, test } from "vitest";

import { appendTestScript, buildTestScript } from "../../packages/core/domain/test-script.service";
import type { EndpointSpec, PostmanEvent } from "../../packages/contracts/interfaces/core/postman.interface";

const spec = (method: EndpointSpec["method"]): EndpointSpec =>
  ({ name: "x", method, uri: "/x" }) as EndpointSpec;

const scriptOf = (method: EndpointSpec["method"]): string =>
  buildTestScript(spec(method)).script.exec.join("\n");

describe("the expected code comes from the verb", () => {
  // A fixed 200 would fail red on a perfectly correct API: a POST that
  // creates returns 201, and a DELETE returns 204 without a body.
  test("a POST accepts the 201 of creation", () => {
    expect(scriptOf("POST")).toContain("201");
  });

  test("a DELETE accepts the 204 without body", () => {
    expect(scriptOf("DELETE")).toContain("204");
  });

  test("a GET does not expect a 201", () => {
    const codes = /include\(pm\.response\.code\)/.test(scriptOf("GET"));
    expect(codes).toBe(true);
    expect(scriptOf("GET")).not.toContain("[200, 201");
  });

  test("all supported verbs produce a script", () => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const) {
      expect(buildTestScript(spec(m)).script.exec.length).toBeGreaterThan(3);
    }
  });
});

describe("the body is only checked when there can be one", () => {
  // `pm.response.json()` on a 204 throws: there is no body to parse.
  test("the JSON test skips codes without a body", () => {
    const script = scriptOf("POST");
    expect(script).toContain("204");
    expect(script).toMatch(/includes\(pm\.response\.code\)\) return/);
  });

  test("and also skips content that is not JSON", () => {
    expect(scriptOf("GET")).toContain("Content-Type");
  });
});

describe("shape of the event", () => {
  test("it is a `test` event, not a `prerequest`", () => {
    expect(buildTestScript(spec("GET")).listen).toBe("test");
  });

  test("the script type is what Postman expects", () => {
    expect(buildTestScript(spec("GET")).script.type).toBe("text/javascript");
  });

  test("flags that it is generated, so nobody takes it as hand-written", () => {
    expect(scriptOf("GET")).toContain("Tanit");
  });
});

describe("what is NOT asserted", () => {
  /**
   * This project scans what the API **receives**. What it returns is
   * unknown, so claiming a `GET /users` returns an array would be
   * guessing — and would fail red on any API that wraps the response in
   * `{ data: [...] }`.
   */
  test("nothing is asserted about the shape of the response", () => {
    const script = scriptOf("GET");
    expect(script).not.toMatch(/to\.be\.an\(['"]array['"]\)/);
    expect(script).not.toMatch(/\.to\.have\.property/);
  });
});

describe("unrecognized method", () => {
  // A verb outside the catalog (e.g. CONNECT, TRACE) falls back to 200.
  test("an unknown method accepts 200 as a fallback", () => {
    const script = buildTestScript({ name: "x", method: "CONNECT" as string as EndpointSpec["method"], uri: "/x" })
      .script.exec.join("\n");
    expect(script).toContain("[200]");
  });
});

describe("appendTestScript", () => {
  // Login already carries its token-capture script; appendTestScript
  // keeps it and appends the new one at the end, without overwriting.
  test("preserves prior events and appends the new one", () => {
    const existing: PostmanEvent[] = [{ listen: "test", script: { type: "text/javascript", exec: ["// pre"] } }];
    const s = spec("GET");
    const result = appendTestScript(existing, s);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existing[0]);
    expect(result[1]?.listen).toBe("test");
  });

  test("with no prior events produces exactly the generated script", () => {
    const s = spec("DELETE");
    const result = appendTestScript(undefined, s);
    expect(result).toHaveLength(1);
    expect(result[0]?.script.exec.join("\n")).toContain("DELETE");
  });
});
