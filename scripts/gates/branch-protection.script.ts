#!/usr/bin/env bun
/**
 * `bun run scripts/gates/branch-protection.script.ts`
 *
 * Verifica en GitHub que las dos ramas que declara la política —la de
 * integración y la de release— y cualquier `release/*` existente
 * tengan branch protection activada y exijan los checks del workflow
 * principal de validación.
 *
 * Ejecución real:
 *   GITHUB_TOKEN=<token> GITHUB_REPOSITORY=<owner/repo> \
 *     bun run scripts/gates/branch-protection.script.ts
 *
 * Para tests no hace falta credenciales: `fetch` y `baseUrl` son
 * inyectables desde `validateBranchProtection()`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CI_CONFIG = JSON.parse(readFileSync(resolve(ROOT, "delendai.config.json"), "utf8")) as {
  development?: {
    branches?: {
      integration?: string;
      release?: string;
    };
    integration?: {
      requiredChecks?: ReadonlyArray<string>;
      requireLatestIntegration?: boolean;
      requiredApprovals?: number;
      releaseRequiredApprovals?: number;
      linearHistory?: boolean;
      allowForcePush?: boolean;
      allowDeleteIntegrationBranch?: boolean;
      mergeMethod?: string;
    };
  };
};

/**
 * The canonical development policy is the ONLY source here.
 *
 * `ci.branchProtection` used to be a second one, and by the time this
 * repository adopted shared-checkout-pr the two disagreed: it still asked
 * for one approving review on `develop` while the policy had moved to
 * autonomous integration, and it listed ten required contexts where the
 * policy names one aggregate gate. This gate VERIFIES the live branch, so
 * a stale duplicate here does not merely describe the wrong rule — it
 * fails the build for matching the right one.
 *
 * Values the policy does not state are not invented. This script cannot
 * expand a delendai profile, so the shape below carries only what the
 * config actually declares, and the comparisons that have no declared
 * source were dropped rather than guessed.
 */
const DEVELOPMENT_INTEGRATION = CI_CONFIG.development?.integration;

if (DEVELOPMENT_INTEGRATION === undefined) {
  throw new Error(
    "delendai.config.json has no .development.integration block. This gate refuses to " +
      "verify a branch against a policy nobody declared: a check that invents its own " +
      "expectation passes whatever it finds.",
  );
}

export const REQUIRED_CHECKS: ReadonlyArray<string> =
  DEVELOPMENT_INTEGRATION.requiredChecks ?? [];

if (REQUIRED_CHECKS.length === 0) {
  throw new Error(
    "development.integration.requiredChecks is empty. A branch protected by no required " +
      "check is a gate that passes anything while looking protected.",
  );
}

export const BRANCH_PROTECTION_POLICY = {
  // `requireLatestIntegration` IS strict status checks: the candidate is
  // re-validated against the current head, which is what stops two
  // independently green pull requests from combining into a red branch.
  requiredStatusChecksStrict:
    DEVELOPMENT_INTEGRATION.requireLatestIntegration ?? true,
  requiredApprovingReviewCount: DEVELOPMENT_INTEGRATION.requiredApprovals ?? 0,
  // The switches the policy DOES declare are read from it, so the config
  // and the live branch cannot disagree. `linearHistory` is the one that
  // bites: the profile `shared-checkout-pr` allows a merge commit to carry
  // the lineage, but a branch that forbids merge commits rejects every push
  // that contains one — and a repository that declares `linearHistory` has
  // already answered that question for itself.
  requiredLinearHistory: DEVELOPMENT_INTEGRATION.linearHistory ?? true,
  allowForcePushes: DEVELOPMENT_INTEGRATION.allowForcePush ?? false,
  allowDeletions: DEVELOPMENT_INTEGRATION.allowDeleteIntegrationBranch ?? false,
  // The method the policy says a change lands with. The REPOSITORY keeps
  // its own switch for it (`allow_merge_commit`), and the two are not
  // the same thing: with that switch off, the policy's `merge` is a
  // sentence nobody can execute, the integration falls back to squash,
  // and the history gets flattened — the graph stops saying which line
  // each change came from. The policy said `merge` while the repository
  // still only allowed `squash`, and that gap is exactly what this
  // compares.
  mergeMethod: DEVELOPMENT_INTEGRATION.mergeMethod ?? "squash",
  // Not derivable from the config: it comes from the profile, which only
  // the delendai runtime can expand. It is the invariant this repository
  // fixes for every profile it uses, stated here once rather than
  // duplicated into the config as a knob nobody edits.
  enforceAdmins: true,
} as const;

export type FetchLike = typeof fetch;

/**
 * The branch the integration happens on, and the branch a version is cut
 * from.
 *
 * Both come from the policy (`development.branches`), not from a name
 * written here: a gate that hardcodes the branches it protects stops
 * protecting the day the policy moves them.
 */
const DECLARED_BRANCHES = CI_CONFIG.development?.branches;

if (
  DECLARED_BRANCHES === undefined ||
  typeof DECLARED_BRANCHES.integration !== "string" ||
  typeof DECLARED_BRANCHES.release !== "string"
) {
  throw new Error(
    "delendai.config.json has no .development.branches block declaring both `integration` " +
      "and `release`. This gate refuses to guess which branches it protects: a gate that " +
      "keeps its own names passes while the policy points somewhere else.",
  );
}

export const INTEGRATION_BRANCH: string = DECLARED_BRANCHES.integration;
export const RELEASE_BRANCH: string = DECLARED_BRANCHES.release;

/**
 * The approvals the **release** branch asks for.
 *
 * The integration branch integrates autonomously; the release branch is
 * the one where a version is cut, and there the gate stays shut until
 * somebody has looked. That is what `releaseRequiredApprovals` says —
 * and it is what the gate compares, because a branch protected with
 * fewer approvals than the policy declares is a branch where a release
 * can slip out unattended.
 */
export const RELEASE_APPROVALS: number =
  DEVELOPMENT_INTEGRATION.releaseRequiredApprovals ??
  BRANCH_PROTECTION_POLICY.requiredApprovingReviewCount;

/**
 * How many approvals a branch asks for, by its role.
 *
 * The integration branch and the release branch are the same repository
 * with two different jobs, and they do not have the same door.
 */
export function requiredApprovalsFor(branch: string): number {
  return branch === RELEASE_BRANCH ? RELEASE_APPROVALS : BRANCH_PROTECTION_POLICY.requiredApprovingReviewCount;
}

interface IResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface IRequestUrlLike {
  readonly hostname: string;
  readonly protocol: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
}

export interface IBranchProtectionOptions {
  readonly repository?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly branches?: ReadonlyArray<string>;
}

export interface IBranchCheckResult {
  readonly branch: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface IBranchProtectionResult {
  readonly ok: boolean;
  readonly repository: string;
  readonly checkedBranches: ReadonlyArray<string>;
  readonly results: ReadonlyArray<IBranchCheckResult>;
}

interface IGitHubBranchSummary {
  readonly name?: string;
}

/**
 * GitHub returns the branch-protection switches as OBJECTS with an
 * `enabled` flag, not as bare booleans:
 *
 *   "required_linear_history": { "enabled": true }
 *   "allow_force_pushes":      { "enabled": false }
 *   "allow_deletions":         { "enabled": false }
 *
 * Reading them as booleans compares an object to `true`, which is never
 * equal, so every comparison below diverged and the gate failed against
 * a perfectly conformant branch. `enforce_admins` already had the
 * right shape here; these four did not, and the fixture that "proved"
 * the gate worked mocked them as bare booleans — which is how a broken
 * gate stayed green in CI.
 */
interface IGitHubBranchDetails {
  readonly name?: string;
  readonly protected?: boolean;
  readonly required_status_checks?: {
    readonly strict?: boolean;
    readonly contexts?: ReadonlyArray<string> | null;
  } | null;
  readonly enforce_admins?: { readonly enabled?: boolean } | null;
  readonly required_pull_request_reviews?: {
    readonly required_approving_review_count?: number;
    readonly dismiss_stale_reviews?: boolean;
    readonly require_code_owner_reviews?: boolean;
  } | null;
  readonly required_linear_history?: { readonly enabled?: boolean } | null;
  readonly allow_force_pushes?: { readonly enabled?: boolean } | null;
  readonly allow_deletions?: { readonly enabled?: boolean } | null;
  readonly required_conversation_resolution?: { readonly enabled?: boolean } | null;
}

/**
 * The repository's own merge switches.
 *
 * These are NOT the branch's protection: `allow_merge_commit` decides
 * whether a merge commit may be created at all, and it lives on the
 * repository, not on `develop`. A branch can perfectly accept merge
 * commits while the repository refuses to produce them — which is the
 * state this gate exists to catch.
 */
interface IGitHubRepositoryDetails {
  readonly allow_merge_commit?: boolean;
  readonly allow_squash_merge?: boolean;
  readonly allow_rebase_merge?: boolean;
}

interface IGitHubErrorPayload {
  readonly message?: string;
}

export async function validateBranchProtection(
  options: IBranchProtectionOptions,
): Promise<IBranchProtectionResult> {
  const repository = normalizeRepository(options.repository);
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const branches = await resolveBranches({
    repository,
    token: options.token,
    baseUrl,
    fetchImpl,
    requestedBranches: options.branches,
  });

  const results: IBranchCheckResult[] = [];
  results.push(
    await checkMergeStrategy({
      repository,
      token: options.token,
      baseUrl,
      fetchImpl,
    }),
  );
  for (const branch of branches) {
    results.push(
      await checkBranchProtection({
        repository,
        branch,
        token: options.token,
        baseUrl,
        fetchImpl,
      }),
    );
  }

  return {
    ok: results.every((result) => result.ok),
    repository,
    checkedBranches: branches,
    results,
  };
}

export interface IResolveBranchesOptions {
  readonly repository: string;
  readonly token?: string;
  readonly baseUrl: string;
  readonly fetchImpl: FetchLike;
  readonly requestedBranches?: ReadonlyArray<string>;
}

/**
 * The branches this gate checks when nobody named them.
 *
 * Exported because it is the line that decides whether the branch a
 * version is cut from is watched at all: the list was `develop` plus
 * the `release/*` ones, and the branch where the releases happen was
 * the one nobody verified. A list that decides what is watched has to
 * be reachable from a test, or it is a claim and not a check.
 */
export async function resolveBranches(options: IResolveBranchesOptions): Promise<ReadonlyArray<string>> {
  const requested = (options.requestedBranches ?? [])
    .map((branch) => branch.trim())
    .filter((branch) => branch.length > 0);
  if (requested.length > 0) {
    return [...new Set(requested)];
  }

  const branchesUrl = new URL(
    `/repos/${options.repository}/branches?per_page=100`,
    `${options.baseUrl}/`,
  );
  const response = await fetchImplWithAuth(options.fetchImpl, branchesUrl, options.token);

  if (response.status === 404) {
    throw new Error(
      `Repositorio o API inexistente para ${options.repository}. ` +
        `GitHub devolvió 404 al listar ramas.`,
    );
  }

  if (!response.ok) {
    throw new Error(await formatGitHubError(response, `No se pudo listar ramas en ${options.repository}`));
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error(`GitHub devolvió una respuesta inesperada al listar ramas de ${options.repository}.`);
  }

  const releaseBranches = payload
    .map((entry) => (entry as IGitHubBranchSummary).name)
    .filter((name): name is string => typeof name === "string" && name.startsWith("release/"));

  // The branch a version is cut from is checked too. It was NOT, and
  // that is how `main` kept a protection that contradicted the policy:
  // the gate only ever looked at `develop` and at the `release/*`
  // branches, so the branch where the releases happen was the one
  // nobody verified.
  return [...new Set([INTEGRATION_BRANCH, RELEASE_BRANCH, ...releaseBranches])];
}

interface ICheckBranchProtectionOptions {
  readonly repository: string;
  readonly branch: string;
  readonly token?: string;
  readonly baseUrl: string;
  readonly fetchImpl: FetchLike;
}

interface ICheckMergeStrategyOptions {
  readonly repository: string;
  readonly token?: string;
  readonly baseUrl: string;
  readonly fetchImpl: FetchLike;
}

/**
 * Does the REPOSITORY allow the method the policy declares?
 *
 * `required_linear_history` is the branch's half of this; this is the
 * repository's half. They can disagree with each other AND with the
 * policy, and each disagreement hides the branches in a different way:
 * a branch that forbids merge commits rejects the push that carries
 * one, and a repository that does not allow them squashes it instead —
 * the work lands, and nothing says which line it came from.
 *
 * The comparison is against the policy, not against a constant: the
 * policy is the only place that says how a change lands.
 */
async function checkMergeStrategy(
  options: ICheckMergeStrategyOptions,
): Promise<IBranchCheckResult> {
  const repositoryUrl = new URL(`/repos/${options.repository}`, `${options.baseUrl}/`);
  const response = await fetchImplWithAuth(
    options.fetchImpl,
    repositoryUrl,
    options.token,
  );

  if (!response.ok) {
    return {
      branch: "(repository)",
      ok: false,
      detail: await formatGitHubError(
        response,
        `No se pudo leer el repositorio ${options.repository}`,
      ),
    };
  }

  const payload = (await response.json()) as IGitHubRepositoryDetails;
  const declared = BRANCH_PROTECTION_POLICY.mergeMethod;
  const expected = declared === "merge";

  // `allow_merge_commit` is absent when the response does not carry the
  // repository's merge settings — a token with less than metadata read
  // on this repository. Nothing is concluded from that: a check that
  // invents its own expectation passes whatever it finds, and a check
  // that fails on what it could not read is just a broken build. The
  // token the CI uses CAN read it, and the divergence is caught there.
  if (payload.allow_merge_commit === undefined) {
    return {
      branch: "(repository)",
      ok: true,
      detail: `allow_merge_commit ausente en la respuesta; no se concluye nada de la estrategia de merge`,
    };
  }

  if (payload.allow_merge_commit !== expected) {
    return {
      branch: "(repository)",
      ok: false,
      detail:
        `la politica declara mergeMethod=${declared} y el repositorio ` +
        `allow_merge_commit=${String(payload.allow_merge_commit)}; ` +
        `el trabajo aterrizaria aplastado y el grafo dejaria de contar de donde sale`,
    };
  }

  return {
    branch: "(repository)",
    ok: true,
    detail: `allow_merge_commit=${String(payload.allow_merge_commit)} coincide con mergeMethod=${declared}`,
  };
}

async function checkBranchProtection(
  options: ICheckBranchProtectionOptions,
): Promise<IBranchCheckResult> {
  const branchUrl = new URL(
    `/repos/${options.repository}/branches/${encodeURIComponent(options.branch)}`,
    `${options.baseUrl}/`,
  );
  const branchResponse = await fetchImplWithAuth(options.fetchImpl, branchUrl, options.token);

  if (branchResponse.status === 404) {
    return {
      branch: options.branch,
      ok: false,
      detail: `rama inexistente o API no expone ${options.branch} (404)`,
    };
  }

  if (!branchResponse.ok) {
    return {
      branch: options.branch,
      ok: false,
      detail: await formatGitHubError(
        branchResponse,
        `GitHub rechazó la consulta de ${options.branch}`,
      ),
    };
  }

  const branchPayload = (await branchResponse.json()) as IGitHubBranchDetails;
  if (branchPayload.protected !== true) {
    return {
      branch: options.branch,
      ok: false,
      detail: `protected=true ausente`,
    };
  }

  const protectionUrl = new URL(
    `/repos/${options.repository}/branches/${encodeURIComponent(options.branch)}/protection`,
    `${options.baseUrl}/`,
  );
  const protectionResponse = await fetchImplWithAuth(
    options.fetchImpl,
    protectionUrl,
    options.token,
  );
  if (protectionResponse.status === 404) {
    // 404 en `/protection` significa "la rama no tiene regla", no
    // "faltan contexts". Decirlo mal manda a corregir un campo dentro
    // de una protección que no existe.
    return {
      branch: options.branch,
      ok: false,
      detail: `la rama no tiene ninguna regla de protección`,
    };
  }
  if (protectionResponse.status === 401 || protectionResponse.status === 403) {
    // NO es lo mismo que "la protección está mal". No se ha leído nada,
    // así que no se concluye nada sobre ella: leer branch protection
    // exige Administration: read, y el token por defecto de Actions no
    // lo tiene. Un check que no pudo verificar una propiedad tampoco
    // puede certificarla, así que sigue siendo un fallo — pero con el
    // motivo correcto y el remedio a mano.
    return {
      branch: options.branch,
      ok: false,
      detail: `no se pudo leer la protección (HTTP ${protectionResponse.status}); nada se concluye de ello. Configura BRANCH_PROTECTION_TOKEN con Administration: read`,
    };
  }
  if (!protectionResponse.ok) {
    return {
      branch: options.branch,
      ok: false,
      detail: await formatGitHubError(
        protectionResponse,
        `GitHub rechazó la protección de ${options.branch}`,
      ),
    };
  }

  const payload = (await protectionResponse.json()) as IGitHubBranchDetails;
  const contexts = payload.required_status_checks?.contexts;
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return {
      branch: options.branch,
      ok: false,
      detail: `required_status_checks.contexts ausente`,
    };
  }

  const missingChecks = REQUIRED_CHECKS.filter((check) => !contexts.includes(check));
  if (missingChecks.length > 0) {
    return {
      branch: options.branch,
      ok: false,
      detail: `faltan required checks: ${missingChecks.join(", ")}`,
    };
  }

  if (payload.required_status_checks?.strict !== BRANCH_PROTECTION_POLICY.requiredStatusChecksStrict ||
      payload.enforce_admins?.enabled !== BRANCH_PROTECTION_POLICY.enforceAdmins) {
    return { branch: options.branch, ok: false, detail: "strict o enforce_admins divergen de la política" };
  }

  const reviews = payload.required_pull_request_reviews;
  const expectedApprovals = requiredApprovalsFor(options.branch);
  if (reviews?.required_approving_review_count !== expectedApprovals) {
    return {
      branch: options.branch,
      ok: false,
      detail:
        `la rama pide ${String(reviews?.required_approving_review_count)} aprobaciones y la política declara ${expectedApprovals}. ` +
        `Protege la rama con la política, o cambia la política: mientras las dos digan cosas distintas, ` +
        `la puerta que decide qué sale de aquí tiene dos respuestas.`,
    };
  }

  if (payload.required_linear_history?.enabled !== BRANCH_PROTECTION_POLICY.requiredLinearHistory ||
      payload.allow_force_pushes?.enabled !== BRANCH_PROTECTION_POLICY.allowForcePushes ||
      payload.allow_deletions?.enabled !== BRANCH_PROTECTION_POLICY.allowDeletions) {
    // Which of the three diverged is said out loud: "la historia, el
    // force-push o el borrado" leaves the reader to guess which one,
    // and the remedy is only actionable once the reader knows.
    const diverging: string[] = [];
    if (payload.required_linear_history?.enabled !== BRANCH_PROTECTION_POLICY.requiredLinearHistory) {
      diverging.push(`la historia (linearHistory=${String(payload.required_linear_history?.enabled)})`);
    }
    if (payload.allow_force_pushes?.enabled !== BRANCH_PROTECTION_POLICY.allowForcePushes) {
      diverging.push(`el force-push (allowForcePushes=${String(payload.allow_force_pushes?.enabled)})`);
    }
    if (payload.allow_deletions?.enabled !== BRANCH_PROTECTION_POLICY.allowDeletions) {
      diverging.push(`el borrado (allowDeletions=${String(payload.allow_deletions?.enabled)})`);
    }

    return {
      branch: options.branch,
      ok: false,
      detail:
        `${diverging.join(", ")} divergen de la política. ` +
        `La política dice mergeMethod="${BRANCH_PROTECTION_POLICY.mergeMethod}" y linearHistory=${String(BRANCH_PROTECTION_POLICY.requiredLinearHistory)}: ` +
        `exigir historia lineal en una rama que se integra con merge commit rechaza el propio merge commit, ` +
        `y la promoción acaba aplastada con squash — que es lo que deja fuera del árbol los commits que \`lint:proposals\` audita. ` +
        `Protege la rama con la política, o cambia la política: mientras las dos digan cosas distintas, ` +
        `la puerta que decide qué sale de aquí tiene dos respuestas.`,
    };
  }

  // The `required-checks` RULESET this gate used to verify is gone, and
  // so is the query for it. It applied a second, differently-sourced check
  // list on top of classic branch protection, so the forge itself carried
  // two answers to "what must pass on develop" — and they had already
  // diverged. Classic protection is what the policy projects and what the
  // rest of this function checks.

  return {
    branch: options.branch,
    ok: true,
    detail: `protected=true, ${REQUIRED_CHECKS.length} checks requeridos, revisiones y reglas de rama conformes con la política`,
  };
}

function normalizeRepository(repository?: string): string {
  const value = repository?.trim();
  if (!value) {
    throw new Error(
      "Falta GITHUB_REPOSITORY. La ejecución real requiere GITHUB_TOKEN y GITHUB_REPOSITORY.",
    );
  }
  if (!/^[^/]+\/[^/]+$/.test(value)) {
    throw new Error(`GITHUB_REPOSITORY debe tener la forma owner/repo; recibido: ${value}`);
  }
  return value;
}

function normalizeBaseUrl(baseUrl?: string): string {
  const value = (baseUrl ?? DEFAULT_GITHUB_API_BASE_URL).trim();
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function fetchImplWithAuth(
  fetchImpl: FetchLike,
  url: IRequestUrlLike,
  token?: string,
): Promise<IResponseLike> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "tanit-branch-protection-gate",
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  const port = url.port ? `:${url.port}` : "";
  return fetchImpl(
    `${url.protocol}//${url.hostname}${port}${url.pathname}${url.search}`,
    { headers },
  ) as Promise<IResponseLike>;
}

async function formatGitHubError(response: IResponseLike, prefix: string): Promise<string> {
  let message = "respuesta sin detalle";
  try {
    const payload = (await response.json()) as IGitHubErrorPayload;
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      message = payload.message.trim();
    }
  } catch {
    const text = await response.text();
    if (text.trim().length > 0) {
      message = text.trim();
    }
  }
  return `${prefix}: HTTP ${response.status} ${message}`;
}

export async function main(): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;

  if (!token?.trim() || !repository?.trim()) {
    console.error(
      "branch-protection — la ejecución real requiere GITHUB_TOKEN y GITHUB_REPOSITORY. " +
        "Para tests, usa validateBranchProtection() con fetch/baseUrl inyectables.",
    );
    return 1;
  }

  try {
    const result = await validateBranchProtection({ token, repository });
    for (const branchResult of result.results) {
      const prefix = branchResult.ok ? "ok   " : "FAIL ";
      console.log(`${prefix}${branchResult.branch.padEnd(20)} ${branchResult.detail}`);
    }
    if (!result.ok) {
      console.error(
        `\nbranch-protection — ${result.repository} no cumple la política de protección requerida.`,
      );
      return 1;
    }

    console.log(
      `\nbranch-protection — ${result.repository} exige ${REQUIRED_CHECKS.join(", ")} ` +
        `en ${result.checkedBranches.join(", ")}.`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`branch-protection — FAIL ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}