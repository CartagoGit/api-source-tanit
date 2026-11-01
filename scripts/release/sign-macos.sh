#!/usr/bin/env bash
#
# `scripts/release/sign-macos.sh` — `codesign` con hardened runtime.
#
# ## Las cuatro cosas que no son negociables
#
#   · `--options runtime` → **hardened runtime**. Sin ella el Gatekeeper
#     no acepta el bundle, y el proceso puede cargar librerías firmadas
#     con otra identidad.
#   · `--timestamp` → **timestamp seguro**. Sin timestamp la firma
#     caduca cuando caduca el certificado, y el instalador deja de
#     abrir en la máquina de al lado — que es donde se nota.
#   · `--entitlements` → **entitlements mínimos**. Cada entitlement de
#     más es una capacidad de más para quien consiga ejecutar código
#     dentro del proceso.
#   · `--force` → resigna. Tauri ya firma alguna cosa durante el
#     empaquetado, y una firma encima de otra no vale.
#
# ## Lo que se firma primero
#
# Un `.app` es un directorio con dentro el binario, el sidecar y los
# frameworks. `codesign` exige que todo lo que hay dentro esté firmado
# con la misma identidad, así que los Mach-O de dentro se firman antes
# que el bundle.
#
# ## Lo que NO hace este script
#
# No notariza. Eso es `notarize-macos.sh`, y va después: la
# notarización necesita el artefacto ya firmado.
#
# Uso:
#   scripts/release/sign-macos.sh <artefacto> [<artefacto>...]
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
readonly DEFAULT_ENTITLEMENTS="${REPO_ROOT}/packages/desktop/entitlements/Tanit.entitlements.plist"

die() {
  printf '✗ %s\n' "$1" >&2
  exit 1
}

note() {
  printf '→ %s\n' "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required and was not found in PATH (this script only runs on macOS)"
}

# --- argumentos ------------------------------------------------------------

if [[ $# -eq 0 ]]; then
  sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  die "No artifact given"
fi

need_cmd codesign

IDENTITY="${TANIT_SIGN_APPLE_IDENTITY:-}"
TEAM_ID="${TANIT_SIGN_APPLE_TEAM_ID:-}"
ENTITLEMENTS="${TANIT_SIGN_ENTITLEMENTS:-${DEFAULT_ENTITLEMENTS}}"

[[ -n "${IDENTITY}" ]] || die "TANIT_SIGN_APPLE_IDENTITY is not set: the release cannot sign without a Developer ID"
[[ -n "${TEAM_ID}" ]] || die "TANIT_SIGN_APPLE_TEAM_ID is not set: the receipt needs the team id"
[[ -f "${ENTITLEMENTS}" ]] || die "The entitlements file does not exist: ${ENTITLEMENTS}"

if [[ -n "${TANIT_SIGN_KEYCHAIN:-}" ]]; then
  note "Keychain: ${TANIT_SIGN_KEYCHAIN}"
fi

note "Identity: ${IDENTITY}"
note "Entitlements: ${ENTITLEMENTS}"

# --- firma -----------------------------------------------------------------

sign_one() {
  local artifact="$1"

  if [[ -d "${artifact}" ]]; then
    # Los Mach-O de dentro primero: el bundle no es válido si lo que
    # contiene lleva otra firma.
    local binary
    while IFS= read -r -d '' binary; do
      if file -b "${binary}" | grep -q 'Mach-O'; then
        codesign --force --options runtime --timestamp --sign "${IDENTITY}" "${binary}"
      fi
    done < <(find "${artifact}" -type f -perm -u+x -print0)
  fi

  codesign \
    --force \
    --options runtime \
    --timestamp \
    --entitlements "${ENTITLEMENTS}" \
    --sign "${IDENTITY}" \
    "${artifact}"

  codesign --verify --deep --strict --verbose=2 "${artifact}" >/dev/null 2>&1 \
    || die "codesign could not verify what it just signed: ${artifact}"

  note "Signed: ${artifact}"
}

for artifact in "$@"; do
  [[ -e "${artifact}" ]] || die "The artifact does not exist: ${artifact}"
  sign_one "${artifact}"
done

note "Done. Every artifact carries a hardened-runtime signature with a secure timestamp."
