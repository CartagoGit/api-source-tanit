#!/usr/bin/env bash
#
# `scripts/release/sign-linux.sh` — checksums firmados con GPG.
#
# ## Qué produce
#
#   <stage>/<os>/<arch>/checksums/SHA256SUMS        generado con `sha256sum`
#   <stage>/<os>/<arch>/checksums/SHA256SUMS.sig    firma detached de los checksums
#   <stage>/<os>/<arch>/keyring/<keyring>.gpg        clave pública publicada
#   <stage>/<os>/<arch>/<bundle>/<artefacto>.sig    firma detached por artefacto
#   <stage>/<os>/<arch>/<bundle>/<artefacto>.signature.json   recibo de la firma
#
# ## Por qué el keyring va aparte
#
# La verificación **no** puede usar el keyring de quien verifica: si
# aceptase cualquier clave que encuentre en su anillo, firmaría el
# atacante y publicaría su binario. El keyring publicado es el que
# dice qué clave es la de la release, y por eso se genera aquí con
# `--export` —sólo la parte pública— y se publica con la release.
#
# ## El recibo
#
# Cada artefacto firmado deja un `.signature.json` con el digest que
# tenía **cuando se firmó**. Si el fichero cambia después, el digest
# ya no cuadra y el verificador lo nota sin necesitar la clave.
#
# Uso:
#   scripts/release/sign-linux.sh --stage <dir> [--os linux] [--arch x64]
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

STAGE=""
OS="linux"
ARCH="x64"
CHECKSUMS_NAME="SHA256SUMS"

# --- utilidades -----------------------------------------------------------

die() {
  printf '✗ %s\n' "$1" >&2
  exit 1
}

note() {
  printf '→ %s\n' "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required and was not found in PATH"
}

# Escapa un valor para poder meterlo en un JSON.
json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

sha256_of() {
  sha256sum "$1" | cut -d' ' -f1
}

# --- argumentos ------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="${2:-}"; shift 2 ;;
    --os) OS="${2:-}"; shift 2 ;;
    --arch) ARCH="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -n "${STAGE}" ]] || die "--stage is required"
[[ -d "${STAGE}" ]] || die "The staging directory does not exist: ${STAGE}"

need_cmd gpg
need_cmd sha256sum
need_cmd find

# --- credenciales ----------------------------------------------------------
#
# Los valores se leen del entorno y **nunca** se imprimen: un log de CI
# es un sitio público, y una clave GPG en un log es una clave GPG
# filtrada.

KEY_ID="${TANIT_SIGN_GPG_KEY_ID:-}"
KEYRING="${TANIT_SIGN_GPG_KEYRING:-}"
PASSPHRASE="${TANIT_SIGN_GPG_PASSPHRASE:-}"

[[ -n "${KEY_ID}" ]] || die "TANIT_SIGN_GPG_KEY_ID is not set: the release cannot sign without a key id"
[[ -n "${KEYRING}" ]] || die "TANIT_SIGN_GPG_KEYRING is not set: the release cannot publish a keyring to verify against"

GPG_ARGS=(--batch --yes --no-tty)
if [[ -n "${PASSPHRASE}" ]]; then
  GPG_ARGS+=(--pinentry-mode loopback --passphrase "${PASSPHRASE}")
fi

# --- dónde están los artefactos -------------------------------------------

PLATFORM_DIR="${STAGE}/${OS}/${ARCH}"
[[ -d "${PLATFORM_DIR}" ]] || die "No artifacts for ${OS}/${ARCH} under ${STAGE}"

CHECKSUM_DIR="${PLATFORM_DIR}/checksums"
KEYRING_DIR="${PLATFORM_DIR}/keyring"
mkdir -p "${CHECKSUM_DIR}" "${KEYRING_DIR}"

# Los instaladores de la plataforma, sin sus firmas ni sus recibos.
mapfile -t ARTIFACTS < <(
  find "${PLATFORM_DIR}" -mindepth 2 -maxdepth 2 -type f \
    ! -name '*.sig' ! -name '*.signature.json' | LC_ALL=C sort
)

[[ ${#ARTIFACTS[@]} -gt 0 ]] || die "No artifacts found under ${PLATFORM_DIR}"

note "Signing ${#ARTIFACTS[@]} artifact(s) for ${OS}/${ARCH}"

# --- la clave y su keyring publicado ---------------------------------------

KEY_FINGERPRINT="$(gpg --list-keys --with-colons "${KEY_ID}" 2>/dev/null | awk -F: '/^fpr:/ {print $10; exit}')"
[[ -n "${KEY_FINGERPRINT}" ]] || die "The signing key '${KEY_ID}' was not found in the keyring"

SIGNER="$(gpg --list-keys --with-colons "${KEY_ID}" 2>/dev/null | awk -F: '/^uid:/ {print $10; exit}')"
[[ -n "${SIGNER}" ]] || SIGNER="${KEY_ID}"

KEYRING_FILE="${KEYRING_DIR}/$(basename "${KEYRING}")"
mkdir -p "$(dirname "${KEYRING_FILE}")"
gpg --export "${KEY_ID}" > "${KEYRING_FILE}"
[[ -s "${KEYRING_FILE}" ]] || die "The published keyring came out empty"
note "Published keyring: ${KEYRING_FILE}"

# --- los checksums ---------------------------------------------------------
#
# Las rutas del fichero son relativas al directorio donde vive, que es
# como funciona `sha256sum -c`: el que verifica se puts en ese
# directorio y el fichero dice exactamente qué comprobar.

(
  cd "${CHECKSUM_DIR}"
  relative_paths=()
  for artifact in "${ARTIFACTS[@]}"; do
    relative_paths+=("../$(basename "$(dirname "${artifact}")")/$(basename "${artifact}")")
  done
  sha256sum "${relative_paths[@]}" > "${CHECKSUMS_NAME}"
)
CHECKSUM_FILE="${CHECKSUM_DIR}/${CHECKSUMS_NAME}"
note "Checksums: ${CHECKSUM_FILE}"

# --- las firmas ------------------------------------------------------------

gpg "${GPG_ARGS[@]}" --detach-sign --output "${CHECKSUM_FILE}.sig" --local-user "${KEY_ID}" "${CHECKSUM_FILE}"
note "Signed: $(basename "${CHECKSUM_FILE}.sig")"

for artifact in "${ARTIFACTS[@]}"; do
  gpg "${GPG_ARGS[@]}" --detach-sign --output "${artifact}.sig" --local-user "${KEY_ID}" "${artifact}"
  digest="$(sha256_of "${artifact}")"
  cat > "${artifact}.signature.json" <<EOF
{
  "kind": "gpg-detached",
  "signer": "$(json_escape "${SIGNER}")",
  "keyId": "$(json_escape "${KEY_FINGERPRINT}")",
  "timestamped": false,
  "sha256": "${digest}"
}
EOF
  note "Signed: $(basename "${artifact}")"
done

note "Done. ${#ARTIFACTS[@]} artifact(s) signed with key ${KEY_FINGERPRINT}"
