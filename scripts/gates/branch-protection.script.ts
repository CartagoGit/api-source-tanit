#!/usr/bin/env bun
/**
 * `bun run scripts/gates/branch-protection.script.ts`
 *
 * Verifica en GitHub que `develop` y cualquier `release/*` existente
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
  ci: {
    requiredChecks: ReadonlyArray<string>;
    branchProtection: {
      rulesetName: string;
      requiredStatusChecksStrict: boolean;
      enforceAdmins: boolean;
      requiredApprovingReviewCount: number;
      dismissStaleReviews: boolean;
      requireCodeOwnerReviews: boolean;
      requiredLinearHistory: boolean;
      allowForcePushes: boolean;
      allowDeletions: boolean;
      requiredConversationResolution: boolean;
    };
  };
};

export const REQUIRED_CHECKS = CI_CONFIG.ci.requiredChecks;
export const BRANCH_PROTECTION_POLICY = CI_CONFIG.ci.branchProtection;

export type FetchLike = typeof fetch;

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
  readonly required_linear_history?: boolean;
  readonly allow_force_pushes?: boolean;
  readonly allow_deletions?: boolean;
  readonly required_conversation_resolution?: boolean;
}

interface IGitHubRuleset {
  readonly name?: string;
  readonly target?: string;
  readonly enforcement?: string;
  readonly conditions?: {
    readonly ref_name?: {
      readonly include?: ReadonlyArray<string>;
    };
  };
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

interface IResolveBranchesOptions {
  readonly repository: string;
  readonly token?: string;
  readonly baseUrl: string;
  readonly fetchImpl: FetchLike;
  readonly requestedBranches?: ReadonlyArray<string>;
}

async function resolveBranches(options: IResolveBranchesOptions): Promise<ReadonlyArray<string>> {
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

  return ["develop", ...releaseBranches];
}

interface ICheckBranchProtectionOptions {
  readonly repository: string;
  readonly branch: string;
  readonly token?: string;
  readonly baseUrl: string;
  readonly fetchImpl: FetchLike;
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
    return {
      branch: options.branch,
      ok: false,
      detail: `required_status_checks.contexts ausente`,
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
  if (reviews?.required_approving_review_count !== BRANCH_PROTECTION_POLICY.requiredApprovingReviewCount ||
      reviews.dismiss_stale_reviews !== BRANCH_PROTECTION_POLICY.dismissStaleReviews ||
      reviews.require_code_owner_reviews !== BRANCH_PROTECTION_POLICY.requireCodeOwnerReviews) {
    return {
      branch: options.branch,
      ok: false,
      detail: `required_pull_request_reviews diverge de la política`,
    };
  }

  if (payload.required_linear_history !== BRANCH_PROTECTION_POLICY.requiredLinearHistory ||
      payload.allow_force_pushes !== BRANCH_PROTECTION_POLICY.allowForcePushes ||
      payload.allow_deletions !== BRANCH_PROTECTION_POLICY.allowDeletions ||
      payload.required_conversation_resolution !== BRANCH_PROTECTION_POLICY.requiredConversationResolution) {
    return { branch: options.branch, ok: false, detail: "historial, force-push, borrado o conversaciones divergen de la política" };
  }

  const rulesetsUrl = new URL(
    `/repos/${options.repository}/rulesets?includes_parents=true&per_page=100`,
    `${options.baseUrl}/`,
  );
  const rulesetsResponse = await fetchImplWithAuth(options.fetchImpl, rulesetsUrl, options.token);
  if (!rulesetsResponse.ok) {
    return {
      branch: options.branch,
      ok: false,
      detail: await formatGitHubError(rulesetsResponse, `GitHub rechazó la consulta de rulesets`),
    };
  }
  const rulesets = (await rulesetsResponse.json()) as unknown;
  if (!Array.isArray(rulesets) || !rulesets.some((ruleset) => {
    const candidate = ruleset as IGitHubRuleset;
    const branchRef = `refs/heads/${options.branch}`;
    return candidate.name === BRANCH_PROTECTION_POLICY.rulesetName && candidate.target === "branch" && candidate.enforcement === "active" &&
      candidate.conditions?.ref_name?.include?.some((pattern) =>
        pattern === options.branch || pattern === branchRef || pattern === "refs/heads/*");
  })) {
    return {
      branch: options.branch,
      ok: false,
      detail: `ruleset activo ausente para ${options.branch}`,
    };
  }

  return {
    branch: options.branch,
    ok: true,
    detail: `protected=true, ${REQUIRED_CHECKS.length} checks requeridos, PR review y ruleset activo presentes`,
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