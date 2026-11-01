#!/usr/bin/env bash
#
# `scripts/release/notarize-macos.sh` — `notarytool` y `stapler`.
#
# ## La secuencia, y por qué en este orden
#
#   1. `notarytool submit --wait` — se **espera** a que Apple acepte.
#      `--wait` no es un adorno: sin él el comando vuelve cuando la
#     submission entra en cola, y el `stapler` de después falla con un
#      "ticket not found" que parece un problema de credenciales.
#   2. Se comprueba que el estado es `Accepted`. Un `Invalid` es un
#      rechazo de Apple, y publicar eso es publicar algo que Gatekeeper
#      va a tirar.
#   3. `stapler staple` — el ticket se grapa **dentro** del artefacto,
#      para que la comprobación funcione sin red.
#   4. `stapler validate` — se comprueba que el ticket está.
#   5. El digest se calcula **después** de grapar: grapar cambia los
#      bytes, y un digest calculado antes describiría un fichero que ya
#      no existe.
#
# ## El `.app` se publica comprimido
#
# Un `.app` es un directorio, y un directorio no tiene un digest. Lo que
# se publica es el `.app` comprimido, ya grapado, con el recibo al lado.
# El bundle se firma, se notariza y se grapa **antes** de comprimirlo.
#
# Uso:
#   scripts/release/notarize-macos.sh <artefacto> [<artefacto>...]
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

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

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

sha256_of() {
  shasum -a 256 "$1" | cut -d' ' -f1
}

# --- argumentos ------------------------------------------------------------

if [[ $# -eq 0 ]]; then
  sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  die "No artifact given"
fi

need_cmd xcrun
need_cmd shasum
need_cmd ditto

IDENTITY="${TANIT_SIGN_APPLE_IDENTITY:-}"
TEAM_ID="${TANIT_SIGN_APPLE_TEAM_ID:-}"
NOTARY_PROFILE="${TANIT_SIGN_NOTARY_PROFILE:-}"

[[ -n "${IDENTITY}" ]] || die "TANIT_SIGN_APPLE_IDENTITY is not set"
[[ -n "${TEAM_ID}" ]] || die "TANIT_SIGN_APPLE_TEAM_ID is not set"

# El perfil del keychain es la vía normal en CI: se guarda una vez al
# empezar el job y no deja la contraseña en el entorno de cada paso.
NOTARY_ARGS=()
if [[ -n "${NOTARY_PROFILE}" ]]; then
  NOTARY_ARGS+=(--keychain-profile "${NOTARY_PROFILE}")
else
  [[ -n "${TANIT_SIGN_APPLE_ID:-}" ]] || die "TANIT_SIGN_NOTARY_PROFILE is not set and no direct Apple credentials were given"
  [[ -n "${TANIT_SIGN_APPLE_PASSWORD:-}" ]] || die "TANIT_SIGN_NOTARY_PROFILE is not set and no direct Apple credentials were given"
  NOTARY_ARGS+=(--apple-id "${TANIT_SIGN_APPLE_ID}" --team-id "${TEAM_ID}" --password "${TANIT_SIGN_APPLE_PASSWORD}")
fi

# --- notarización ----------------------------------------------------------

notarize_one() {
  local artifact="$1"
  local output status

  output="$(xcrun notarytool submit "${artifact}" --wait --output-format json "${NOTARY_ARGS[@]}" 2>&1)" || {
    printf '%s\n' "${output}" >&2
    die "notarytool could not process ${artifact}"
  }

  status="$(printf '%s' "${output}" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
  if [[ "${status}" != "Accepted" ]]; then
    printf '%s\n' "${output}" >&2
    die "notarytool did not accept ${artifact} (status: ${status:-unknown})"
  fi
  note "Notarized: ${artifact}"

  xcrun stapler staple "${artifact}" || die "stapler could not staple ${artifact}"
  xcrun stapler validate "${artifact}" || die "stapler could not validate ${artifact}"
  note "Stapled: ${artifact}"
}

# --- el recibo -------------------------------------------------------------
#
# El recibo ata la firma a los bytes publicados: lleva el digest
# **después** de grapar, y sin él el verificador no puede saber si el
# fichero que se publica es el que se notarizó.

write_receipt() {
  local published="$1"
  local signer="$2"

  cat > "${published}.signature.json" <<EOF
{
  "kind": "notarization",
  "signer": "$(json_escape "${signer}")",
  "keyId": "$(json_escape "${TEAM_ID}")",
  "timestamped": true,
  "notarized": true,
  "stapled": true,
  "sha256": "$(sha256_of "${published}")"
}
EOF
}

for artifact in "$@"; do
  [[ -e "${artifact}" ]] || die "The artifact does not exist: ${artifact}"

  codesign --verify --deep --strict "${artifact}" >/dev/null 2>&1 \
    || die "The artifact is not signed: ${artifact} (sign it before notarizing it)"

  notarize_one "${artifact}"

  if [[ -d "${artifact}" ]]; then
    # Un `.app` es un directorio: lo que se publica es el bundle
    # comprimido, ya grapado.
    published="${artifact}.zip"
    rm -f "${published}"
    ditto -c -k --keepParent "${artifact}" "${published}"
    write_receipt "${published}" "${IDENTITY}"
    note "Published: ${published}"
  else
    write_receipt "${artifact}" "${IDENTITY}"
  fi
done

note "Done. Every artifact is notarized, stapled and carries its receipt."
