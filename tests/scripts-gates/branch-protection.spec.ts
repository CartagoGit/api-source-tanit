import { describe, expect, test } from "vitest";

import {
  BRANCH_PROTECTION_POLICY,
  REQUIRED_CHECKS,
  validateBranchProtection,
  type FetchLike,
} from "../../scripts/gates/branch-protection.script";

function jsonResponse(body: unknown, init?: ResponseInit): InstanceType<typeof Response> {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function createFetchStub(
  routes: Record<string, InstanceType<typeof Response>>,
): FetchLike {
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
        }),
        [`${baseUrl}/repos/CartagoGit/api-source-tanit/branches/develop/protection`]: jsonResponse({
          required_status_checks: {
            strict: true,
            contexts: [...REQUIRED_CHECKS],
          },
          enforce_admins: { enabled: true },
          required_pull_request_reviews: {
            // 0 — the policy integrates autonomously. The fixture used
            // to say 1, which is what `ci.branchProtection` asked for
            // before it was removed as a second source of truth.
            required_approving_review_count: 0,
          },
          required_linear_history: { enabled: BRANCH_PROTECTION_POLICY.requiredLinearHistory },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
          required_conversation_resolution: { enabled: true },
        }),
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      {
        branch: "develop",
        ok: true,
        detail: `protected=true, ${REQUIRED_CHECKS.length} checks requeridos, revisiones y reglas de rama conformes con la política`,
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
        }),
        [`${baseUrl}/repos/CartagoGit/api-source-tanit/branches/develop/protection`]: jsonResponse({
          // Everything else conforms, so the ONLY thing this fixture can
          // fail on is the missing check. It names a DIFFERENT context
          // rather than an empty list, because an empty list is its own
          // refusal ("contexts ausente") and would not exercise the
          // "this specific check is missing" message. It used to drop a
          // check by name; the policy now names its own checks.
          required_status_checks: {
            strict: true,
            contexts: ["some-other-check"],
          },
          enforce_admins: { enabled: true },
          required_pull_request_reviews: {
            required_approving_review_count: 0,
          },
          required_linear_history: { enabled: BRANCH_PROTECTION_POLICY.requiredLinearHistory },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      branch: "develop",
      ok: false,
      detail: `faltan required checks: ${REQUIRED_CHECKS[0]}`,
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

  test("the live policy does not demand linear history, so a merge commit can land", () => {
    // The policy and the branch have to agree HERE as well as in the
    // config: `develop` accepts merge commits precisely because the
    // branch no longer forbids them. If someone turns `linearHistory`
    // back on in `delendai.config.json`, the forge has to be changed in
    // the same breath — otherwise the first merge commit is rejected by
    // the branch, and the graph stops telling the story.
    expect(BRANCH_PROTECTION_POLICY.requiredLinearHistory).toBe(false);
    expect(BRANCH_PROTECTION_POLICY.requiredStatusChecksStrict).toBe(true);
    expect(BRANCH_PROTECTION_POLICY.requiredApprovingReviewCount).toBe(0);
  });
});