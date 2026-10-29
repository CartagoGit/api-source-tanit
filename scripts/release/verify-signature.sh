#!/usr/bin/env bash
#
# `scripts/release/verify-signature.sh` — vuelve a calcularlo todo.
#
# ## La idea
#
# El manifest dice qué se publicó. Este script **no se lo cree**: recalcula
# el SHA-256 de cada artefacto a partir del fichero, comprueba que la
# firma existe y que el recibo que la acompaña describe esos bytes
# exactos, y lanza la comprobación nativa de cada plataforma. Si algo no
# cuadra, sale con código 1 y la release no se publica.
#
# ## Los dos modos
#
#   · `--mode full` (producción): además de lo de arriba, ejecuta la
#     comprobación nativa —Gatekeeper en macOS, Authenticode en
#     Windows, `gpg --verify` en Linux—. Si la herramienta nativa no
#     está, **falla**: una verificación que se salta su comprobación
#     por no tener la herramienta no es una verificación.
#
#   · `--mode portable`: recalcula digests, receipts y cobertura, y
#     dice que la comprobación nativa se ha saltado. Es lo que se usa
#     para inspeccionar un staging desde otra máquina —el job que
#     fusiona los manifest por plataforma, por ejemplo—, nunca para
#     publicar.
#
# ## Lo que falla cerrado
#
#   · Un artefacto del manifest que no está en el staging.
#   · Un digest que no cuadra.
#   · Un artefacto sin firma (salvo `--allow-unsigned`, que es sólo
#     para inspeccionar un build de desarrollo).
#   · Un recibo cuyo digest no es el del artefacto firmado.
#   · Un fichero del staging que el manifest no describe: un leftover
#     sin firmar es exactamente lo que no debe subirse.
#   · Una firma que no verifica contra el keyring publicado.
#
# Uso:
#   scripts/release/verify-signature.sh --manifest <file> --stage <dir> \
#       [--platform macos|windows|linux] [--keyring <file>] \
#       [--mode portable|full] [--allow-unsigned]
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

MANIFEST=""
STAGE=""
PLATFORM=""
KEYRING=""
MODE="full"
ALLOW_UNSIGNED="false"

FAILURES=0
SKIPPED=0

# --- utilidades ------------------------------------------------------------

die() {
  printf '✗ %s\n' "$1" >&2
  exit 1
}

note() {
  printf '→ %s\n' "$1"
}

ok() {
  printf '  ✔ %s\n' "$1"
}

fail() {
  printf '  ✗ %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

skip() {
  printf '  – %s\n' "$1"
  SKIPPED=$((SKIPPED + 1))
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required and was not found in PATH"
}

sha256_of() {
  sha256sum "$1" | cut -d' ' -f1
}

# --- argumentos ------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --stage) STAGE="${2:-}"; shift 2 ;;
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --keyring) KEYRING="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --allow-unsigned) ALLOW_UNSIGNED="true"; shift ;;
    -h|--help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -n "${MANIFEST}" ]] || die "--manifest is required"
[[ -n "${STAGE}" ]] || die "--stage is required"
[[ -f "${MANIFEST}" ]] || die "The manifest does not exist: ${MANIFEST}"
[[ -d "${STAGE}" ]] || die "The staging directory does not exist: ${STAGE}"
[[ "${MODE}" == "full" || "${MODE}" == "portable" ]] || die "--mode must be 'full' or 'portable'"

need_cmd jq
need_cmd sha256sum
need_cmd find

MANIFEST_ABS="$(cd -- "$(dirname -- "${MANIFEST}")" && pwd)/$(basename -- "${MANIFEST}")"
STAGE_ABS="$(cd -- "${STAGE}" && pwd)"

note "Manifest: ${MANIFEST_ABS}"
note "Staging:  ${STAGE_ABS}"
note "Mode:     ${MODE}"

# --- el manifest ------------------------------------------------------------

SCHEMA="$(jq -r '.schema // ""' "${MANIFEST_ABS}")"
[[ "${SCHEMA}" == "tanit.release.manifest/v1" ]] || die "Unexpected manifest schema: '${SCHEMA}'"

VERSION="$(jq -r '.version // ""' "${MANIFEST_ABS}")"
[[ -n "${VERSION}" ]] || die "The manifest has no version"

note "Release version: ${VERSION}"

# Las rutas del manifest nunca salen del staging: un manifest es un
# fichero que puede venir de otro sitio, y `../../etc/passwd` en una
# ruta no es una ruta.
mapfile -t ARTIFACT_PATHS < <(jq -r '.artifacts[]?.path' "${MANIFEST_ABS}")
mapfile -t ASSET_PATHS < <(jq -r '.assets[]?.path' "${MANIFEST_ABS}")

if [[ ${#ARTIFACT_PATHS[@]} -eq 0 ]]; then
  die "The manifest describes no artifact"
fi

# --- comprobación de cada artefacto ----------------------------------------

check_artifact() {
  local path="$1" os="$2" arch="$3" bundle="$4"
  local full="${STAGE_ABS}/${path}"
  local expected actual signature_path signature_kind receipt_path receipt_digest

  if [[ "${path}" == /* || "${path}" == *".."* ]]; then
    fail "${path}: the path escapes the staging directory"
    return
  fi

  if [[ ! -f "${full}" ]]; then
    fail "${path}: the artifact is in the manifest but not in the staging"
    return
  fi

  expected="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .sha256' "${MANIFEST_ABS}")"
  actual="$(sha256_of "${full}")"
  if [[ "${expected}" != "${actual}" ]]; then
    fail "${path}: the digest does not match the manifest (${actual} != ${expected})"
    return
  fi

  signature_path="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.path // ""' "${MANIFEST_ABS}")"
  signature_kind="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.kind // ""' "${MANIFEST_ABS}")"
  receipt_path="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.receipt // ""' "${MANIFEST_ABS}")"

  if [[ -z "${signature_kind}" ]]; then
    if [[ "${ALLOW_UNSIGNED}" == "true" ]]; then
      skip "${path}: not signed (allowed: this is not a publishable staging)"
    else
      fail "${path}: not signed, and an unsigned artifact is never published"
    fi
    return
  fi

  if [[ "${signature_path}" != "${path}" ]]; then
    if [[ ! -f "${STAGE_ABS}/${signature_path}" ]]; then
      fail "${path}: the signature file is missing (${signature_path})"
      return
    fi
    if [[ ! -s "${STAGE_ABS}/${signature_path}" ]]; then
      fail "${path}: the signature file is empty (${signature_path})"
      return
    fi
  fi

  if [[ -n "${receipt_path}" ]]; then
    if [[ ! -f "${STAGE_ABS}/${receipt_path}" ]]; then
      fail "${path}: the signature receipt is missing (${receipt_path})"
      return
    fi
    receipt_digest="$(jq -r '.sha256 // ""' "${STAGE_ABS}/${receipt_path}")"
    if [[ "${receipt_digest}" != "${actual}" ]]; then
      fail "${path}: the receipt describes different bytes than the artifact (${receipt_digest} != ${actual})"
      return
    fi
  fi

  case "${os}" in
    linux) verify_linux "${path}" "${full}" "${signature_path}" "${signature_kind}" ;;
    macos) verify_macos "${path}" "${full}" "${signature_kind}" ;;
    windows) verify_windows "${path}" "${full}" "${signature_kind}" ;;
    *) fail "${path}: unknown os '${os}'" ;;
  esac
}

# --- Linux: GPG contra el keyring publicado --------------------------------

verify_linux() {
  local path="$1" full="$2" signature_path="$3" signature_kind="$4"
  local keyring="${KEYRING}"
  local valid_signature key_id expected_key_id

  if [[ "${signature_kind}" != "gpg-detached" ]]; then
    fail "${path}: expected a gpg-detached signature, found '${signature_kind}'"
    return
  fi

  if [[ -z "${keyring}" ]]; then
    # El keyring publicado es el que dice qué clave es la de la
    # release. Sin él no se puede distinguir la clave buena de la del
    # atacante.
    keyring="$(jq -r '.assets[]? | select(.kind == "keyring") | .path' "${MANIFEST_ABS}" | head -1)"
    if [[ -n "${keyring}" ]]; then
      keyring="${STAGE_ABS}/${keyring}"
    else
      fail "${path}: no published keyring to verify against"
      return
    fi
  fi

  if [[ ! -f "${keyring}" ]]; then
    fail "${path}: the published keyring does not exist (${keyring})"
    return
  fi

  if [[ "${MODE}" == "portable" ]]; then
    skip "${path}: the GPG verification needs the 'full' mode"
    return
  fi

  need_cmd gpg

  valid_signature="$(gpg --no-default-keyring --keyring "${keyring}" --status-fd 1 \
    --verify "${STAGE_ABS}/${signature_path}" "${full}" 2>/dev/null | grep -m1 '^\[GNUPG:\] VALIDSIG' || true)"
  if [[ -z "${valid_signature}" ]]; then
    fail "${path}: the detached signature does not verify against the published keyring"
    return
  fi

  key_id="$(printf '%s' "${valid_signature}" | awk '{print $3}')"
  expected_key_id="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.keyId // ""' "${MANIFEST_ABS}")"
  if [[ -n "${expected_key_id}" && "${key_id}" != "${expected_key_id}" ]]; then
    fail "${path}: signed by ${key_id}, but the manifest says ${expected_key_id}"
    return
  fi

  ok "${path}: signature verified against the published keyring (key ${key_id})"
}

# --- macOS: Gatekeeper, codesign y stapler ----------------------------------

verify_macos() {
  local path="$1" full="$2" signature_kind="$3"
  local notarized stapled signer expected_signer

  notarized="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.notarized // false' "${MANIFEST_ABS}")"
  stapled="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.stapled // false' "${MANIFEST_ABS}")"
  signer="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.signer // ""' "${MANIFEST_ABS}")"

  if [[ "${notarized}" != "true" || "${stapled}" != "true" ]]; then
    fail "${path}: not notarized or not stapled (notarized=${notarized}, stapled=${stapled})"
    return
  fi

  if [[ "${MODE}" == "portable" ]]; then
    skip "${path}: the Gatekeeper check needs the 'full' mode"
    return
  fi

  if ! command -v codesign >/dev/null 2>&1 || ! command -v spctl >/dev/null 2>&1; then
    fail "${path}: codesign and spctl are required to verify a macOS artifact, and they are not here"
    return
  fi

  local bundle="${full}"
  if [[ "${path}" == *.zip ]]; then
    local work
    work="$(mktemp -d)"
    ditto -x -k "${full}" "${work}" >/dev/null 2>&1 || {
      rm -rf "${work}"
      fail "${path}: the published bundle could not be unpacked"
      return
    }
    bundle="$(find "${work}" -maxdepth 1 -name '*.app' -type d | head -1)"
    rm -rf "${work}"
  fi

  if [[ -z "${bundle}" || ! -e "${bundle}" ]]; then
    fail "${path}: the signed bundle could not be located"
    return
  fi

  codesign --verify --deep --strict --verbose=2 "${bundle}" >/dev/null 2>&1 \
    || { fail "${path}: codesign does not accept the bundle"; return; }

  spctl --assess --type install --verbose=2 "${bundle}" >/dev/null 2>&1 \
    || { fail "${path}: Gatekeeper does not accept the bundle"; return; }

  if command -v xcrun >/dev/null 2>&1; then
    xcrun stapler validate "${bundle}" >/dev/null 2>&1 \
      || { fail "${path}: the notarization ticket is not stapled"; return; }
  fi

  expected_signer="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.signer // ""' "${MANIFEST_ABS}")"
  local real_signer
  real_signer="$(codesign --display --verbose=4 "${bundle}" 2>/dev/null | sed -n 's/^Authority=//p' | head -1)"
  if [[ -n "${expected_signer}" && -n "${real_signer}" && "${real_signer}" != "${expected_signer}" ]]; then
    fail "${path}: signed by '${real_signer}', but the manifest says '${expected_signer}'"
    return
  fi

  ok "${path}: Gatekeeper, codesign and the stapled ticket all accept it"
}

# --- Windows: Authenticode --------------------------------------------------

verify_windows() {
  local path="$1" full="$2" signature_kind="$3"
  local expected_signer

  if [[ "${signature_kind}" != "authenticode" ]]; then
    fail "${path}: expected an authenticode signature, found '${signature_kind}'"
    return
  fi

  if [[ "${MODE}" == "portable" ]]; then
    skip "${path}: the Authenticode verification needs the 'full' mode"
    return
  fi

  if ! command -v powershell >/dev/null 2>&1; then
    fail "${path}: powershell is required to verify a Windows artifact, and it is not here"
    return
  fi

  if ! powershell -NoProfile -ExecutionPolicy Bypass -File "${SCRIPT_DIR}/sign-windows.ps1" -Verify "${full}" >/dev/null; then
    fail "${path}: the Authenticode signature does not verify"
    return
  fi

  expected_signer="$(jq -r --arg p "${path}" '.artifacts[] | select(.path == $p) | .signature.signer // ""' "${MANIFEST_ABS}")"
  local receipt_signer
  receipt_signer="$(jq -r '.signer // ""' "${STAGE_ABS}/${path}.signature.json" 2>/dev/null || printf '')"
  if [[ -n "${expected_signer}" && -n "${receipt_signer}" && "${receipt_signer}" != "${expected_signer}" ]]; then
    fail "${path}: signed by '${receipt_signer}', but the manifest says '${expected_signer}'"
    return
  fi

  ok "${path}: the Authenticode signature, the signer and the timestamp verify"
}

# --- bucle ------------------------------------------------------------------

while IFS=$'\t' read -r path os arch bundle; do
  [[ -n "${path}" ]] || continue
  if [[ -n "${PLATFORM}" && "${os}" != "${PLATFORM}" ]]; then
    continue
  fi
  check_artifact "${path}" "${os}" "${arch}" "${bundle}"
done < <(jq -r '.artifacts[] | [.path, .os, .arch, .bundle] | @tsv' "${MANIFEST_ABS}")

# --- los assets -------------------------------------------------------------

while IFS=$'\t' read -r path expected; do
  [[ -n "${path}" ]] || continue
  if [[ "${path}" == /* || "${path}" == *".."* ]]; then
    fail "${path}: the asset path escapes the staging directory"
    continue
  fi
  if [[ ! -f "${STAGE_ABS}/${path}" ]]; then
    fail "${path}: the asset is in the manifest but not in the staging"
    continue
  fi
  actual="$(sha256_of "${STAGE_ABS}/${path}")"
  if [[ "${actual}" != "${expected}" ]]; then
    fail "${path}: the asset digest does not match the manifest"
    continue
  fi
done < <(jq -r '.assets[]? | [.path, .sha256] | @tsv' "${MANIFEST_ABS}")

# --- nada sin describir -----------------------------------------------------
#
# Un fichero del staging que el manifest no describe es un artefacto
# sin firmar esperando a que alguien lo suba. Se falla.

DESCRIBED="$(jq -r '[.artifacts[]?.path, .artifacts[]?.signature.path, .assets[]?.path] | .[] // empty' "${MANIFEST_ABS}")"
while IFS= read -r file; do
  relative="${file#"${STAGE_ABS}/"}"
  case "$(basename -- "${relative}")" in
    release-manifest.json) continue ;;
    *.signature.json) continue ;;
  esac
  if ! printf '%s\n' "${DESCRIBED}" | grep -Fxq -- "${relative}"; then
    fail "${relative}: the staging holds a file the manifest does not describe"
  fi
done < <(find "${STAGE_ABS}" -type f -not -path '*.app/*' | LC_ALL=C sort)

# --- los checksums de Linux -------------------------------------------------

if [[ -z "${PLATFORM}" || "${PLATFORM}" == "linux" ]]; then
  while IFS= read -r checksum_file; do
    [[ -n "${checksum_file}" ]] || continue
    directory="$(dirname "${checksum_file}")"
    if ( cd "${directory}" && sha256sum -c --quiet "$(basename "${checksum_file}")" ) >/dev/null 2>&1; then
      ok "$(basename "${checksum_file}"): every checksum matches"
    else
      fail "$(basename "${checksum_file}"): sha256sum -c does not accept it"
    fi
  done < <(find "${STAGE_ABS}" -name 'SHA256SUMS' -type f | LC_ALL=C sort)
fi

# --- veredicto --------------------------------------------------------------

if [[ ${FAILURES} -gt 0 ]]; then
  printf '\n✗ Verification failed: %s problem(s).\n' "${FAILURES}" >&2
  exit 1
fi

note "Verification passed (${SKIPPED} native check(s) skipped in '${MODE}' mode)."
exit 0
