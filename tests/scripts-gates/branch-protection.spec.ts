import { describe, expect, test } from "vitest";

import {
  REQUIRED_CHECKS,
  validateBranchProtection,
  type FetchLike,
} from "../../scripts/gates/branch-protection.script";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function createFetchStub(routes: Record<string, Response>): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const response = routes[url];
    return response ?? jsonResponse({ message: `missing route for ${url}` }, { status: 404 });
  }) as FetchLike;
}

describe("branch-protection gate", () => {
  test("passes when develop is protected and all required checks exist", async () => {
    const baseUrl = "https://mock.github.local";
    const result = await validateBranchProtection({
      repository: "CartagoGit/api-source-tanit",
      token: "test-token",
      baseUrl,
      branches: ["develop"],
      fetchImpl: createFetchStub({
        [`${baseUrl}/repos/CartagoGit/api-source-tanit/branches/develop`]: jsonResponse({
          name: "develop",
          protected: true,
          protection: {
            required_status_checks: {
              contexts: [...REQUIRED_CHECKS],
            },
          },
        }),
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      {
        branch: "develop",
        ok: true,
        detail: `protected=true y ${REQUIRED_CHECKS.length} checks requeridos presentes`,
      },
    ]);
  });

  test("fails explicitly when required checks are missing", async () => {
    const baseUrl = "https://mock.github.local";
    const result = await validateBranchProtection({
      repository: "CartagoGit/api-source-tanit",
      baseUrl,
      branches: ["develop"],
      fetchImpl: createFetchStub({
        [`${baseUrl}/repos/CartagoGit/api-source-tanit/branches/develop`]: jsonResponse({
          name: "develop",
          protected: true,
          protection: {
            required_status_checks: {
              contexts: REQUIRED_CHECKS.filter((check) => check !== "integration-verifier"),
            },
          },
        }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      branch: "develop",
      ok: false,
      detail: "faltan required checks: integration-verifier",
    });
  });

  test("fails explicitly when branch protection is absent", async () => {
    const baseUrl = "https://mock.github.local";
    const result = await validateBranchProtection({
      repository: "CartagoGit/api-source-tanit",
      baseUrl,
      branches: ["develop"],
      fetchImpl: createFetchStub({
        [`${baseUrl}/repos/CartagoGit/api-source-tanit/branches/develop`]: jsonResponse({
          name: "develop",
          protected: false,
          protection: null,
        }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      branch: "develop",
      ok: false,
      detail: "protected=true ausente",
    });
  });

  test("fails explicitly when the branch or API endpoint does not exist", async () => {
    const baseUrl = "https://mock.github.local";
    const result = await validateBranchProtection({
      repository: "CartagoGit/api-source-tanit",
      baseUrl,
      branches: ["develop"],
      fetchImpl: createFetchStub({
        [`${baseUrl}/repos/CartagoGit/api-source-tanit/branches/develop`]: jsonResponse(
          { message: "Branch not found" },
          { status: 404 },
        ),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      branch: "develop",
      ok: false,
      detail: "rama inexistente o API no expone develop (404)",
    });
  });
});