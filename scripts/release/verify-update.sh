#!/usr/bin/env bash
# Independent verification of a signed update manifest.
#
# This script does NOT share code with the client (`packages/desktop/src/updater.rs`)
# nor with the builder (`scripts/release/build-update-manifest.mjs`). That is the
# point: it is the third implementation of the same rules, written with different
# tools, so that a mistake in one of them does not hide behind the others.
#
# It answers one question: "would the client accept this manifest, and why not?"
# The answer has to be the same the client gives, which is why the rejection codes
# here are the same strings declared in
# `packages/contracts/constants/release/updater.constant.ts`.
#
# What it checks, in this order:
#
#   1. The manifest, the signature and the public key exist.
#   2. The manifest is valid JSON and uses the expected schema.
#   3. The signature verifies against the public key.
#   4. The manifest declares the key id the caller expects.
#   5. The offered version is newer than the installed one.
#   6. The installed version is still supported by the manifest.
#   7. There is a target for the requested platform, and its URL is HTTPS.
#   8. With --stage: the artifact exists, its digest matches and its
#      signature verifies.
#
# There is no "unsigned" mode. There is no HTTP. A manifest that does not
# verify is a manifest that does not get installed.
#
# Usage:
#   scripts/release/verify-update.sh --manifest <file> --signature <file> \
#     --public-key <file> [--key-id <id>] [--platform os/arch/bundle] \
#     [--current-version <semver>] [--stage <dir>]
set -euo pipefail

MANIFEST=""
SIGNATURE=""
PUBLIC_KEY=""
KEY_ID=""
PLATFORM=""
CURRENT_VERSION=""
STAGE=""
SMOKE=""
SMOKE_VERSION=""
SMOKE_FIXTURE=""
EXPECTED_SCHEMA="tanit.update.manifest/v1"

SCRATCH=""

die() {
  printf '✗ %s\n' "$1" >&2
  exit 1
}

note() {
  printf '→ %s\n' "$1"
}

ok() {
  printf '✔ %s\n' "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found"
}

cleanup() {
  if [[ -n "${SCRATCH}" && -d "${SCRATCH}" ]]; then
    rm -rf "${SCRATCH}"
  fi
}

usage() {
  cat <<'USAGE'
verify-update — verify a signed update manifest, independently of the client.

  --manifest <file>          the update manifest (latest.json)
  --signature <file>         its detached signature (latest.json.sig)
  --public-key <file>        the versioned public key (PEM)
  --key-id <id>              the key id the caller expects (default: tanit-updater-v1)
  --platform os/arch/bundle  the platform that must have a target
  --current-version <semver> the installed version (default: the manifest's minimum)
  --stage <dir>              staging directory with the artifacts, to verify them too
  --smoke <dir>              unpacked candidate payload: it must contain binaries/apisrc
  --smoke-version <semver>   the version being installed (default: the manifest's)
  --smoke-fixture <dir>      the project the sidecar scans (default: examples/example-express)
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --manifest) MANIFEST="${2:-}"; shift 2 ;;
      --signature) SIGNATURE="${2:-}"; shift 2 ;;
      --public-key) PUBLIC_KEY="${2:-}"; shift 2 ;;
      --key-id) KEY_ID="${2:-}"; shift 2 ;;
      --platform) PLATFORM="${2:-}"; shift 2 ;;
      --current-version) CURRENT_VERSION="${2:-}"; shift 2 ;;
      --stage) STAGE="${2:-}"; shift 2 ;;
      --smoke) SMOKE="${2:-}"; shift 2 ;;
      --smoke-version) SMOKE_VERSION="${2:-}"; shift 2 ;;
      --smoke-fixture) SMOKE_FIXTURE="${2:-}"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
}

# Decodes base64 with whichever spelling the platform uses.
decode_base64() {
  local input="$1" output="$2"
  if base64 -d <"${input}" >"${output}" 2>/dev/null; then
    return 0
  fi
  base64 -D <"${input}" >"${output}"
}

# Compares two semver versions. Returns 0 when $1 is strictly greater than $2.
semver_gt() {
  local left="$1" right="$2"
  local left_pre="" right_pre=""
  if [[ "${left}" == *-* ]]; then left_pre="${left#*-}"; left="${left%%-*}"; fi
  if [[ "${right}" == *-* ]]; then right_pre="${right#*-}"; right="${right%%-*}"; fi

  local -a L R
  IFS='.' read -r -a L <<<"${left}"
  IFS='.' read -r -a R <<<"${right}"
  local index
  for index in 0 1 2; do
    local l=$((10#${L[$index]:-0})) r=$((10#${R[$index]:-0}))
    if ((l > r)); then return 0; fi
    if ((l < r)); then return 1; fi
  done

  # Same numbers: a prerelease is older than the release it precedes.
  if [[ -n "${left_pre}" && -z "${right_pre}" ]]; then return 1; fi
  if [[ -z "${left_pre}" && -n "${right_pre}" ]]; then return 0; fi
  if [[ "${left_pre}" > "${right_pre}" ]]; then return 0; fi
  if [[ "${left_pre}" < "${right_pre}" ]]; then return 1; fi
  return 1
}

# Resolves a path inside a directory and refuses to leave it.
resolve_inside() {
  local base="$1" path="$2"
  local resolved
  resolved="$(cd "$(dirname "${base}/${path}")" 2>/dev/null && pwd)/$(basename "${base}/${path}")" || return 1
  case "${resolved}" in
    "${base}"/*) printf '%s' "${resolved}" ;;
    *) return 1 ;;
  esac
}

# verify_signature <public key> <file> <binary signature>
verify_signature() {
  openssl pkeyutl -verify -pubin -inkey "$1" -rawin -in "$2" -sigfile "$3" >/dev/null 2>&1
}

# The smoke of the candidate: the sidecar that ships inside the installer
# has to be the same version as the app, and it has to work.
#
# The three steps are the ones the desktop app does when it starts:
# handshake (the sidecar answers), scan (it opens a project and takes a
# snapshot) and export (it produces the collection). If any of the three
# fails, the candidate is not installable, however well signed it is.
#
# The exchange is a file in and a file out: the four requests go into a
# file, the sidecar reads them from stdin and writes its answers to
# stdout. That is the same contract the desktop bridge uses —one JSON
# frame per line— without the shell having to juggle a pipe.
smoke_candidate() {
  local payload="$1" expected_version="$2" fixture="$3"
  local sidecar="${payload}/binaries/apisrc"

  if [[ ! -f "${sidecar}" ]]; then
    die "the candidate payload has no sidecar at binaries/apisrc"
  fi
  if [[ ! -x "${sidecar}" ]]; then
    die "the candidate sidecar is not executable: ${sidecar}"
  fi
  ok "the candidate payload contains the sidecar"

  local sidecar_version
  sidecar_version="$("${sidecar}" --version 2>/dev/null | tr -d '[:space:]' | head -1)"
  if [[ "${sidecar_version}" != "${expected_version}" ]]; then
    die "the sidecar reports version '${sidecar_version}' and the update offers '${expected_version}'"
  fi
  ok "the sidecar reports the same version as the update (${sidecar_version})"

  # The sidecar writes the exported collection next to the project it
  # scanned, so the smoke works on a **copy** of the fixture: a smoke
  # that leaves files behind in the repo is a smoke that dirties the
  # tree of whoever lo ejecuta.
  local project="${SCRATCH}/fixture"
  cp -r "${fixture}" "${project}"
  fixture="${project}"

  local requests="${SCRATCH}/requests.jsonl" responses="${SCRATCH}/responses.jsonl"
  {
    # 1. The handshake: a call that needs nothing opened.
    jq -cn '{jsonrpc:"2.0",id:1,method:"list-projects",params:{}}'
    # 2. The scan: the sidecar opens the project and takes its snapshot.
    jq -cn --arg root "${fixture}" '{jsonrpc:"2.0",id:2,method:"open-project",params:{projectRoot:$root}}'
    jq -cn --arg root "${fixture}" '{jsonrpc:"2.0",id:3,method:"snapshot",params:{projectRoot:$root}}'
    # 3. The export: the sidecar produces the collection.
    jq -cn --arg root "${fixture}" '{jsonrpc:"2.0",id:4,method:"export",params:{projectRoot:$root,target:"postman"}}'
  } >"${requests}"

  # The sidecar needs to know which project it is looking at: without a
  # root it refuses to start, on purpose. It does not exit when its
  # input ends —it is a service, not a command— so it runs in the
  # background and the smoke waits for its answers.
  timeout 180 "${sidecar}" serve --stdio --project-root "${fixture}" \
    <"${requests}" >"${responses}" 2>"${SCRATCH}/sidecar.err" &
  local sidecar_pid=$!
  trap 'kill "${sidecar_pid}" 2>/dev/null || true; cleanup' EXIT

  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if grep -q '"id":4' "${responses}" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  kill "${sidecar_pid}" 2>/dev/null || true
  wait "${sidecar_pid}" 2>/dev/null || true
  trap cleanup EXIT

  local id
  for id in 1 2 3 4; do
    if ! grep -q "\"id\":${id}" "${responses}" 2>/dev/null; then
      die "the sidecar did not answer the request ${id}: $(head -3 "${SCRATCH}/sidecar.err" | tr '\n' ' ')"
    fi
    if ! grep "\"id\":${id}" "${responses}" | grep -q '"ok":true'; then
      die "the sidecar failed the request ${id}: $(grep "\"id\":${id}" "${responses}" | head -c 300)"
    fi
  done
  ok "the sidecar answered the handshake"
  ok "the sidecar scanned the project"
  ok "the sidecar exported the collection"
}

main() {
  parse_args "$@"
  trap cleanup EXIT

  [[ -n "${MANIFEST}" ]] || { usage; die "--manifest is required"; }
  [[ -n "${SIGNATURE}" ]] || { usage; die "--signature is required"; }
  [[ -n "${PUBLIC_KEY}" ]] || { usage; die "--public-key is required"; }

  need_cmd jq
  need_cmd openssl
  need_cmd sha256sum
  need_cmd base64

  [[ -f "${MANIFEST}" ]] || die "the manifest is missing: ${MANIFEST}"
  [[ -f "${SIGNATURE}" ]] || die "the signature is missing: ${SIGNATURE}"
  [[ -f "${PUBLIC_KEY}" ]] || die "the public key is missing: ${PUBLIC_KEY}"

  SCRATCH="$(mktemp -d)"

  # 1. The manifest parses. A manifest that does not parse is not a
  #    manifest that "cannot be read yet": it is a manifest that was
  #    touched on the way.
  if ! jq -e . "${MANIFEST}" >/dev/null 2>&1; then
    die "update.manifest.invalid: the manifest is not valid JSON"
  fi
  ok "the manifest is valid JSON"

  schema="$(jq -r '.schema // ""' "${MANIFEST}")"
  if [[ "${schema}" != "${EXPECTED_SCHEMA}" ]]; then
    die "update.manifest.schema_mismatch: the manifest uses '${schema}' and this verifier understands '${EXPECTED_SCHEMA}'"
  fi
  ok "the manifest uses the schema ${EXPECTED_SCHEMA}"

  algorithm="$(jq -r '.signatureAlgorithm // ""' "${MANIFEST}")"
  if [[ "${algorithm}" != "ed25519" ]]; then
    die "update.manifest.invalid: the signature algorithm is '${algorithm}' and only ed25519 is supported"
  fi

  # 2. The signature verifies. This is the check that cannot be
  #    argued with: the manifest is signed by the holder of the
  #    private key.
  decode_base64 "${SIGNATURE}" "${SCRATCH}/manifest.sig"
  if ! verify_signature "${PUBLIC_KEY}" "${MANIFEST}" "${SCRATCH}/manifest.sig"; then
    die "update.signature.invalid: the manifest signature does not verify against the public key"
  fi
  ok "the manifest signature verifies"

  # 3. The key id. A manifest signed with another key is not accepted
  #    just because it verifies: it has to be the key this client was
  #    built with. That is what makes the rotation explicit.
  declared_key_id="$(jq -r '.publicKeyId // ""' "${MANIFEST}")"
  expected_key_id="${KEY_ID:-tanit-updater-v1}"
  if [[ "${declared_key_id}" != "${expected_key_id}" ]]; then
    die "update.public_key.mismatch: the manifest declares '${declared_key_id}' and '${expected_key_id}' was expected"
  fi
  ok "the manifest declares the key ${declared_key_id}"

  # 4. The version. An older or equal version is not an update, and it
  #    is the way back, which does not exist.
  version="$(jq -r '.version // ""' "${MANIFEST}")"
  minimum="$(jq -r '.minimumSupportedVersion // ""' "${MANIFEST}")"
  if [[ -z "${version}" || -z "${minimum}" ]]; then
    die "update.manifest.invalid: the manifest does not declare a version and a minimum supported version"
  fi
  installed="${CURRENT_VERSION:-${minimum}}"
  if ! semver_gt "${version}" "${installed}"; then
    die "update.version.not_newer: the manifest offers ${version} and ${installed} is installed"
  fi
  ok "the manifest offers ${version}, newer than the installed ${installed}"

  if semver_gt "${installed}" "${minimum}"; then
    die "update.version.below_minimum: ${installed} is older than the minimum supported ${minimum}"
  fi
  ok "the installed version ${installed} is still supported"

  # 5. The target. Without a platform there is nothing to check; with
  #    one, the target has to exist and has to be HTTPS.
  if [[ -n "${PLATFORM}" ]]; then
    IFS='/' read -r target_os target_arch target_bundle <<<"${PLATFORM}"
    target_url="$(jq -r --arg o "${target_os}" --arg a "${target_arch}" --arg b "${target_bundle}" \
      '.targets[]? | select(.os == $o and .arch == $a and .bundle == $b) | .url // ""' "${MANIFEST}")"
    if [[ -z "${target_url}" ]]; then
      die "update.target.unsupported: there is no target for ${target_os}/${target_arch}/${target_bundle}"
    fi
    case "${target_url}" in
      https://*) : ;;
      *) die "update.endpoint.not_https: the target URL is not HTTPS: ${target_url}" ;;
    esac
    ok "the manifest has an HTTPS target for ${target_os}/${target_arch}/${target_bundle}"

    # 6. The artifact, when the staging is available.
    if [[ -n "${STAGE}" ]]; then
      target_sha="$(jq -r --arg o "${target_os}" --arg a "${target_arch}" --arg b "${target_bundle}" \
        '.targets[]? | select(.os == $o and .arch == $a and .bundle == $b) | .sha256 // ""' "${MANIFEST}")"
      target_signature="$(jq -r --arg o "${target_os}" --arg a "${target_arch}" --arg b "${target_bundle}" \
        '.targets[]? | select(.os == $o and .arch == $a and .bundle == $b) | .signature // ""' "${MANIFEST}")"
      target_size="$(jq -r --arg o "${target_os}" --arg a "${target_arch}" --arg b "${target_bundle}" \
        '.targets[]? | select(.os == $o and .arch == $a and .bundle == $b) | .size // 0' "${MANIFEST}")"

      # The artifact is the file the URL points at. It is looked up by
      # name inside the staging, and never outside it.
      artifact_name="${target_url##*/}"
      artifact_name="${artifact_name%%\?*}"
      stage_root="$(cd "${STAGE}" && pwd)"
      artifact="$(find "${stage_root}" -type f -name "${artifact_name}" | head -1)"
      if [[ -z "${artifact}" ]]; then
        die "update.hash.mismatch: the staging has no artifact named ${artifact_name}"
      fi
      resolved_artifact="$(resolve_inside "${stage_root}" "${artifact#"${stage_root}"/}")" \
        || die "update.hash.mismatch: the artifact is outside the staging directory"

      actual_sha="$(sha256sum "${resolved_artifact}" | cut -d' ' -f1)"
      if [[ "${actual_sha}" != "${target_sha}" ]]; then
        die "update.hash.mismatch: the artifact digest is ${actual_sha} and the manifest says ${target_sha}"
      fi
      actual_size="$(wc -c <"${resolved_artifact}" | tr -d ' ')"
      if [[ "${actual_size}" != "${target_size}" ]]; then
        die "update.size.mismatch: the artifact is ${actual_size} bytes and the manifest says ${target_size}"
      fi
      ok "the artifact digest and size match the manifest"

      printf '%s' "${target_signature}" | base64 -d >"${SCRATCH}/artifact.sig" 2>/dev/null \
        || printf '%s' "${target_signature}" | base64 -D >"${SCRATCH}/artifact.sig"
      if ! verify_signature "${PUBLIC_KEY}" "${resolved_artifact}" "${SCRATCH}/artifact.sig"; then
        die "update.signature.invalid: the artifact signature does not verify against the public key"
      fi
      ok "the artifact signature verifies"
    fi
  fi

  # 7. The smoke of the candidate: the sidecar that goes inside the
  #    installer has to be the same version as the app, and it has to
  #    survive handshake, scan and export.
  if [[ -n "${SMOKE}" ]]; then
    repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
    smoke_candidate \
      "${SMOKE}" \
      "${SMOKE_VERSION:-${version}}" \
      "${SMOKE_FIXTURE:-${repo_root}/examples/example-express}"
  fi

  note "the update manifest is verified"
}

main "$@"
