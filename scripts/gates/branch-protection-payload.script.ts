#!/usr/bin/env bun
/** Materialize branch protection from the same policy used by its verifier. */
import { BRANCH_PROTECTION_POLICY, INTEGRATION_BRANCH, RELEASE_BRANCH, REQUIRED_CHECKS, requiredApprovalsFor, requiredStrictChecksFor } from "./branch-protection.script.js";

/** Build a GitHub payload without reinterpreting explicit false policy values. */
export function branchProtectionPayload(branch: string) {
  if (branch !== INTEGRATION_BRANCH && branch !== RELEASE_BRANCH && !branch.startsWith("release/")) {
    throw new Error(`No protection policy declared for branch ${branch}`);
  }
  return {
    required_status_checks: { strict: requiredStrictChecksFor(branch), contexts: [...REQUIRED_CHECKS] },
    enforce_admins: BRANCH_PROTECTION_POLICY.enforceAdmins,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true, require_code_owner_reviews: false,
      required_approving_review_count: requiredApprovalsFor(branch),
    },
    restrictions: null,
    required_linear_history: BRANCH_PROTECTION_POLICY.requiredLinearHistory,
    allow_force_pushes: BRANCH_PROTECTION_POLICY.allowForcePushes,
    allow_deletions: BRANCH_PROTECTION_POLICY.allowDeletions,
    block_creations: false,
    required_conversation_resolution: false,
  };
}

if (import.meta.main) {
  const branch = process.argv[2];
  if (!branch) throw new Error("Pass the branch to protect.");
  console.log(JSON.stringify(branchProtectionPayload(branch)));
}
