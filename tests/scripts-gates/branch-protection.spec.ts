import { describe, expect, test } from "vitest";

import {
  BRANCH_PROTECTION_POLICY,
  INTEGRATION_BRANCH,
  RELEASE_APPROVALS,
  RELEASE_BRANCH,
  REQUIRED_CHECKS,
  requiredApprovalsFor,
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

/**
 * The repository's own merge switches.
 *
 * They live on the repository, not on the branch: `allow_merge_commit`
 * decides whether a merge commit may be created at all. A branch can
 * accept merge commits while the repository refuses to produce them,
 * and that gap is what flattens the history.
 */
function repoResponse(allowMergeCommit = true) {
  return jsonResponse({
    allow_merge_commit: allowMergeCommit,
    allow_squash_merge: true,
    allow_rebase_merge: false,
  });
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
        [`${baseUrl}/repos/CartagoGit/api-source-tanit`]: repoResponse(),
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
      {        branch: "(repository)",
        ok: true,
        detail: `allow_merge_commit=true coincide con mergeMethod=merge`,
      },
      {        branch: "develop",
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
        [`${baseUrl}/repos/CartagoGit/api-source-tanit`]: repoResponse(),
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
    expect(result.results[1]).toMatchObject({
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
        [`${baseUrl}/repos/CartagoGit/api-source-tanit`]: repoResponse(),
        [`${baseUrl}/repos/CartagoGit/api-source-tanit/branches/develop`]: jsonResponse({
          name: "develop",
          protected: false,
        }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.results[1]).toMatchObject({
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
        [`${baseUrl}/repos/CartagoGit/api-source-tanit`]: repoResponse(),
        [`${baseUrl}/repos/CartagoGit/api-source-tanit/branches/develop`]: jsonResponse(
          { message: "Branch not found" },
          { status: 404 },
        ),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.results[1]).toMatchObject({
      branch: "develop",
      ok: false,
      detail: "rama inexistente o API no expone develop (404)",
    });
  });

  test("fails when the repository does not allow the merge method the policy declares", async () => {
    const baseUrl = "https://mock.github.local";
    const result = await validateBranchProtection({
      repository: "CartagoGit/api-source-tanit",
      baseUrl,
      branches: ["develop"],
      fetchImpl: createFetchStub({
        // The branch is perfectly protected — and the repository still
        // refuses to produce a merge commit, so the policy's `merge`
        // lands as a squash and the graph stops counting.
        [`${baseUrl}/repos/CartagoGit/api-source-tanit`]: repoResponse(false),
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
          required_pull_request_reviews: { required_approving_review_count: 0 },
          required_linear_history: { enabled: BRANCH_PROTECTION_POLICY.requiredLinearHistory },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      branch: "(repository)",
      ok: false,
    });
    expect(result.results[0].detail).toContain("mergeMethod=merge");
    expect(result.results[0].detail).toContain("allow_merge_commit=false");
  });

  test("concludes nothing when the response does not carry the merge settings", async () => {
    const baseUrl = "https://mock.github.local";
    const result = await validateBranchProtection({
      repository: "CartagoGit/api-source-tanit",
      baseUrl,
      branches: ["develop"],
      fetchImpl: createFetchStub({
        // A token with less than metadata read on the repository gets a
        // response without the merge settings. Failing on what could
        // not be read would be a broken build, not a check.
        [`${baseUrl}/repos/CartagoGit/api-source-tanit`]: jsonResponse({ id: 1 }),
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
          required_pull_request_reviews: { required_approving_review_count: 0 },
          required_linear_history: { enabled: BRANCH_PROTECTION_POLICY.requiredLinearHistory },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        }),
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.results[0]).toMatchObject({
      branch: "(repository)",
      ok: true,
    });
    expect(result.results[0].detail).toContain("no se concluye nada");
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

/**
 * The release branch.
 *
 * It is where a version is cut, and it was the one branch nobody
 * verified: the gate only looked at `develop` and at the `release/*`
 * branches, so `main` could keep a protection that contradicted the
 * policy — historia lineal exigida con `mergeMethod: "merge"` — y la
 * promoción acababa aplastada con squash, que es lo que deja fuera
 * del árbol los commits que `lint:proposals` audita.
 */
describe("la rama de release", () => {
  const BASE_URL = "https://mock.github.local";
  const REPO = "CartagoGit/api-source-tanit";

  function releaseProtection(overrides: Record<string, unknown> = {}) {
    return jsonResponse({
      required_status_checks: {
        strict: true,
        contexts: [...REQUIRED_CHECKS],
      },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {
        // The release branch asks for the approvals the policy
        // declares for it — one, no matter how autonomous the
        // integration is.
        required_approving_review_count: RELEASE_APPROVALS,
      },
      required_linear_history: { enabled: BRANCH_PROTECTION_POLICY.requiredLinearHistory },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_conversation_resolution: { enabled: true },
      ...overrides,
    });
  }

  function routes(protection: InstanceType<typeof Response>) {
    return {
      [`${BASE_URL}/repos/${REPO}`]: repoResponse(),
      [`${BASE_URL}/repos/${REPO}/branches/${RELEASE_BRANCH}`]: jsonResponse({
        name: RELEASE_BRANCH,
        protected: true,
      }),
      [`${BASE_URL}/repos/${REPO}/branches/${RELEASE_BRANCH}/protection`]: protection,
    };
  }

  test("the policy names the release branch and its approvals", () => {
    expect(RELEASE_BRANCH).toBe("main");
    expect(RELEASE_APPROVALS).toBe(1);
    // The two branches do not have the same door: the integration
    // integrates autonomously, the release does not.
    expect(BRANCH_PROTECTION_POLICY.requiredApprovingReviewCount).toBe(0);
    expect(requiredApprovalsFor(RELEASE_BRANCH)).toBe(RELEASE_APPROVALS);
    expect(requiredApprovalsFor(INTEGRATION_BRANCH)).toBe(
      BRANCH_PROTECTION_POLICY.requiredApprovingReviewCount,
    );
  });

  test("passes when the release branch is protected as the policy says", async () => {
    const result = await validateBranchProtection({
      repository: REPO,
      baseUrl: BASE_URL,
      branches: [RELEASE_BRANCH],
      fetchImpl: createFetchStub(routes(releaseProtection())),
    });

    expect(result.ok).toBe(true);
    expect(result.results[1]).toMatchObject({
      branch: RELEASE_BRANCH,
      ok: true,
    });
  });

  test("fails when the release branch asks for fewer approvals than the policy", async () => {
    const result = await validateBranchProtection({
      repository: REPO,
      baseUrl: BASE_URL,
      branches: [RELEASE_BRANCH],
      fetchImpl: createFetchStub(
        routes(
          releaseProtection({
            required_pull_request_reviews: { required_approving_review_count: 0 },
          }),
        ),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.results[1].detail).toContain("0 aprobaciones");
    expect(result.results[1].detail).toContain(String(RELEASE_APPROVALS));
    // The message says what to do, not only what is wrong.
    expect(result.results[1].detail).toContain("Protege la rama con la política");
  });

  test("fails when the release branch demands linear history against the policy", async () => {
    const result = await validateBranchProtection({
      repository: REPO,
      baseUrl: BASE_URL,
      branches: [RELEASE_BRANCH],
      fetchImpl: createFetchStub(
        routes(
          releaseProtection({
            required_linear_history: { enabled: true },
          }),
        ),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.results[1].detail).toContain("historia");
    // It says WHY that combination is the problem: historia lineal
    // rechaza el merge commit que la política declara.
    expect(result.results[1].detail).toContain("merge commit");
  });

  test("fails when the repository refuses the merge method the policy declares", async () => {
    const result = await validateBranchProtection({
      repository: REPO,
      baseUrl: BASE_URL,
      branches: [RELEASE_BRANCH],
      fetchImpl: createFetchStub({
        [`${BASE_URL}/repos/${REPO}`]: repoResponse(false),
        [`${BASE_URL}/repos/${REPO}/branches/${RELEASE_BRANCH}`]: jsonResponse({
          name: RELEASE_BRANCH,
          protected: true,
        }),
        [`${BASE_URL}/repos/${REPO}/branches/${RELEASE_BRANCH}/protection`]: releaseProtection(),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.results[0].detail).toContain("mergeMethod=merge");
    expect(result.results[0].detail).toContain("allow_merge_commit=false");
  });
});