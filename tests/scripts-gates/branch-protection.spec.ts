import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  BRANCH_PROTECTION_POLICY,
  INTEGRATION_BRANCH,
  RELEASE_APPROVALS,
  RELEASE_BRANCH,
  REQUIRED_CHECKS,
  requiredApprovalsFor,
  resolveBranches,
  validateBranchProtection,
  type FetchLike,
} from "../../scripts/gates/branch-protection.script";
import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";

/** The workflow that runs the gate. */
const VALIDATE_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "validate.yml");

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): InstanceType<typeof Response> {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function createFetchStub(
  routes: Record<string, InstanceType<typeof Response>>,
): FetchLike {
  return (async (input: Parameters<FetchLike>[0]) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : "url" in input ? input.url : input.toString();
    const response = routes[url];
    return response ?? jsonResponse({ message: `missing route for ${url}` }, { status: 404 });
  }) as FetchLike;
}

/**
 * The detail of one result.
 *
 * `noUncheckedIndexedAccess` is on, so an index out of range gives
 * `undefined`. A `?.detail` would leave the test green over a
 * message that never arrived; here either the message is there or the
 * test fails.
 */
function detailOf(
  result: { readonly results: ReadonlyArray<{ readonly detail: string }> },
  index: number,
): string {
  const entry = result.results[index];
  if (entry === undefined) {
    throw new Error(`el gate no devolvió el resultado ${index}`);
  }
  return entry.detail;
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
    expect(detailOf(result, 0)).toContain("mergeMethod=merge");
    expect(detailOf(result, 0)).toContain("allow_merge_commit=false");
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
    expect(detailOf(result, 0)).toContain("no se concluye nada");
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
    expect(detailOf(result, 1)).toContain("0 aprobaciones");
    expect(detailOf(result, 1)).toContain(String(RELEASE_APPROVALS));
    // The message says what to do, not only what is wrong.
    expect(detailOf(result, 1)).toContain("Protege la rama con la política");
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
    expect(detailOf(result, 1)).toContain("historia");
    // It says WHICH of the three diverged: "la historia, el force-push
    // o el borrado" leaves the reader to guess, and the remedy is only
    // actionable once the reader knows.
    expect(detailOf(result, 1)).toContain("la historia (linearHistory=true)");
    // It says WHY that combination is the problem: historia lineal
    // rechaza el merge commit que la política declara.
    expect(detailOf(result, 1)).toContain("merge commit");
    // And it says WHAT TO DO, like the approvals divergence does. A
    // message that explains the problem but not the remedy leaves the
    // reader guessing, and this is the divergence that cost a release.
    expect(detailOf(result, 1)).toContain("Protege la rama con la política");
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
    expect(detailOf(result, 0)).toContain("mergeMethod=merge");
    expect(detailOf(result, 0)).toContain("allow_merge_commit=false");
    // The merge method is a switch of the REPOSITORY, so it is
    // checked once for every branch — but the branch being cut is
    // still the one that is on the list, and a release cannot be
    // trusted when the repository refuses the merge commits the
    // policy declares.
    expect(result.checkedBranches).toContain(RELEASE_BRANCH);
  });
});

/**
 * El gate tiene que mirar la rama de release DE VERDAD.
 *
 * Dos líneas deciden si la rama de release está vigilada, y las dos
 * pueden estropearse dejando la CI verde:
 *
 * - la lista de ramas que el gate decide mirar: si la rama de
 *   release sale de la lista, el gate deja de mirarla;
 * - el `if` del job que ejecuta el gate: si el job sólo corre en
 *   `develop`, el gate no llega a ejecutarse sobre `main`.
 *
 * Una línea que decide qué se vigila y no tiene ningún test que la
 * vigile es una afirmación, no una comprobación. Por eso están aquí.
 */
describe("el gate vigila la rama de release de verdad", () => {
  const BASE_URL = "https://mock.github.local";
  const REPO = "CartagoGit/api-source-tanit";

  function recordingFetchStub(
    routes: Record<string, InstanceType<typeof Response>>,
    requested: string[],
  ): FetchLike {
    return (async (input: Parameters<FetchLike>[0]) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : "url" in input ? input.url : input.toString();
      requested.push(url);
      const response = routes[url];
      return response ?? jsonResponse({ message: `missing route for ${url}` }, { status: 404 });
    }) as FetchLike;
  }

  function conformingProtection(approvals: number) {
    return jsonResponse({
      required_status_checks: {
        strict: true,
        contexts: [...REQUIRED_CHECKS],
      },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {
        required_approving_review_count: approvals,
      },
      required_linear_history: { enabled: BRANCH_PROTECTION_POLICY.requiredLinearHistory },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_conversation_resolution: { enabled: true },
    });
  }

  test("la lista de ramas incluye la de release aunque nadie la nombre", async () => {
    const branches = await resolveBranches({
      repository: REPO,
      baseUrl: BASE_URL,
      fetchImpl: createFetchStub({
        [`${BASE_URL}/repos/${REPO}/branches?per_page=100`]: jsonResponse([
          { name: "develop" },
          { name: "main" },
          { name: "release/1.0.0" },
        ]),
      }),
    });

    expect(branches).toEqual([INTEGRATION_BRANCH, RELEASE_BRANCH, "release/1.0.0"]);
  });

  test("sin lista a mano, pregunta por la rama de release y la compara", async () => {
    const requested: string[] = [];
    const result = await validateBranchProtection({
      repository: REPO,
      baseUrl: BASE_URL,
      fetchImpl: recordingFetchStub(
        {
          [`${BASE_URL}/repos/${REPO}/branches?per_page=100`]: jsonResponse([
            { name: "develop" },
            { name: "main" },
            { name: "release/1.0.0" },
          ]),
          [`${BASE_URL}/repos/${REPO}`]: repoResponse(),
          [`${BASE_URL}/repos/${REPO}/branches/develop`]: jsonResponse({
            name: "develop",
            protected: true,
          }),
          [`${BASE_URL}/repos/${REPO}/branches/develop/protection`]: conformingProtection(
            BRANCH_PROTECTION_POLICY.requiredApprovingReviewCount,
          ),
          [`${BASE_URL}/repos/${REPO}/branches/main`]: jsonResponse({
            name: "main",
            protected: true,
          }),
          [`${BASE_URL}/repos/${REPO}/branches/main/protection`]: conformingProtection(RELEASE_APPROVALS),
          [`${BASE_URL}/repos/${REPO}/branches/release%2F1.0.0`]: jsonResponse({
            name: "release/1.0.0",
            protected: true,
          }),
          [`${BASE_URL}/repos/${REPO}/branches/release%2F1.0.0/protection`]: conformingProtection(0),
        },
        requested,
      ),
    });

    expect(result.checkedBranches).toContain(RELEASE_BRANCH);
    // It was really asked about it — and the branch it asked about is
    // the one where a version is cut.
    expect(requested).toContain(`${BASE_URL}/repos/${REPO}/branches/${RELEASE_BRANCH}/protection`);
    expect(result.ok).toBe(true);
  });

  test("el job del gate no está atado a la rama de integración", () => {
    const script =
      `const text = await Bun.file(${JSON.stringify(VALIDATE_WORKFLOW)}).text(); ` +
      `console.log(JSON.stringify(Bun.YAML.parse(text)));`;
    const parsed = spawnSync("bun", ["-e", script], { encoding: "utf8" });
    expect(parsed.status, parsed.stderr).toBe(0);
    const workflow = JSON.parse(parsed.stdout) as {
      readonly on?: { readonly push?: { readonly branches?: ReadonlyArray<string> } };
      readonly jobs: Readonly<Record<string, { readonly if?: unknown }>>;
    };

    // The workflow has to wake up on the release branch...
    expect(workflow.on?.push?.branches).toContain(RELEASE_BRANCH);
    // ...and the gate job must run on a push, not only on the
    // integration branch. Both facts are needed: a condition that
    // says `pull_request` would never run the gate over a push at
    // all, and one that says `refs/heads/develop` would never run it
    // over `main`. Either way the branch where versions are cut stays
    // unwatched while the CI stays green.
    const condition = String(workflow.jobs["branch-protection"]?.if ?? "");
    expect(condition).toContain("push");
    expect(condition).not.toMatch(/refs\/heads\/develop/);
  });
});