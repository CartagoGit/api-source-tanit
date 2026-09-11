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
  development?: {
    integration?: {
      requiredChecks?: ReadonlyArray<string>;
      requireLatestIntegration?: boolean;
      requiredApprovals?: number;
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
  // Not derivable from the config: these come from the profile, which
  // only the delendai runtime can expand. They are the invariants this
  // repository's policy fixes for every profile it uses, stated here once
  // rather than duplicated into the config as knobs nobody edits.
  enforceAdmins: true,
  requiredLinearHistory: true,
  allowForcePushes: false,
  allowDeletions: false,
} as const;

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
  if (reviews?.required_approving_review_count !== BRANCH_PROTECTION_POLICY.requiredApprovingReviewCount) {
    return {
      branch: options.branch,
      ok: false,
      detail: `required_pull_request_reviews diverge de la política`,
    };
  }

  if (payload.required_linear_history !== BRANCH_PROTECTION_POLICY.requiredLinearHistory ||
      payload.allow_force_pushes !== BRANCH_PROTECTION_POLICY.allowForcePushes ||
      payload.allow_deletions !== BRANCH_PROTECTION_POLICY.allowDeletions) {
    return { branch: options.branch, ok: false, detail: "historial, force-push, borrado o conversaciones divergen de la política" };
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