#!/usr/bin/env bash
#
# `scripts/release/sign-linux.sh` — checksums firmados con GPG.
#
# ## Qué produce
#
#   <stage>/<os>/<arch>/checksums/SHA256SUMS                 generado con `sha256sum`
#   <stage>/<os>/<arch>/checksums/SHA256SUMS.sig             firma detached de los checksums
#   <stage>/<os>/<arch>/checksums/SHA256SUMS.signature.json   recibo de esa firma
#   <stage>/<os>/<arch>/keyring/tanit-release-keyring.gpg     clave pública publicada
#   <stage>/<os>/<arch>/<bundle>/<artefacto>.sig             firma detached por artefacto
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
# ## Por qué la clave se importa explícitamente
#
# El script **no** usa el keyring por defecto del runner: crea el
# suyo, en un directorio temporal, e importa en él el keyring que
# apunta `TANIT_SIGN_GPG_KEYRING`. Depender del keyring por defecto
# es depender de que el runner venga preparado, y un runner
# hospedado no viene preparado: la clave no está, el script muere y
# **no se firma ningún `.deb`**. Importar de un fichero explícito
# hace que el fallo sea un fallo de credencial —que se ve— y no un
# artefacto sin firmar que parece firmado.
#
# ## El recibo
#
# Cada artefacto firmado deja un `.signature.json` con el digest que
# tenía **cuando se firmó**. Si el fichero cambia después, el digest
# ya no cuadra y el verificador lo nota sin necesitar la clave.
#
# Uso:
#   scripts/release/sign-linux.sh --stage <dir> [--os linux] [--arch x64]
#
# Entorno:
#   TANIT_SIGN_GPG_KEY_ID      id o huella de la clave de firma (obligatorio)
#   TANIT_SIGN_GPG_KEYRING     fichero del keyring que se importa (obligatorio)
#   TANIT_SIGN_GPG_PASSPHRASE  passphrase de la clave (opcional)
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

# El nombre del keyring publicado. Tiene que ser el mismo que declara
# `RELEASE_KEYRING_FILE` en los contratos: el verificador lo busca por
# su `kind`, no por su nombre, pero la release publica los assets por
# `basename` y dos keyrings con nombres distintos son dos assets
# distintos.
readonly PUBLISHED_KEYRING_NAME="tanit-release-keyring.gpg"

# El nombre del fichero de checksums.
readonly CHECKSUMS_NAME="SHA256SUMS"

STAGE=""
OS="linux"
ARCH="x64"

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
      sed -n '2,55p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
KEYRING_SOURCE="${TANIT_SIGN_GPG_KEYRING:-}"
PASSPHRASE="${TANIT_SIGN_GPG_PASSPHRASE:-}"

[[ -n "${KEY_ID}" ]] || die "TANIT_SIGN_GPG_KEY_ID is not set: the release cannot sign without a key id"
[[ -n "${KEYRING_SOURCE}" ]] || die "TANIT_SIGN_GPG_KEYRING is not set: the release cannot sign without the keyring that holds the signing key"
[[ -f "${KEYRING_SOURCE}" ]] || die "TANIT_SIGN_GPG_KEYRING does not point to a readable file: ${KEYRING_SOURCE}"

# El keyring de trabajo es propio y efímero: el del runner no se toca
# y el script no depende de lo que hubiera en él.
SIGN_HOME="${TANIT_SIGN_GPG_HOME:-}"
if [[ -z "${SIGN_HOME}" ]]; then
  SIGN_HOME="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${SIGN_HOME}'" EXIT
fi
mkdir -p "${SIGN_HOME}"
chmod 700 "${SIGN_HOME}"
export GNUPGHOME="${SIGN_HOME}"

GPG_ARGS=(--batch --yes --no-tty)
if [[ -n "${PASSPHRASE}" ]]; then
  # La passphrase va por un descriptor, no en la línea de órdenes: en
  # `ps` —y en `/proc/<pid>/cmdline`— la vería cualquiera que pueda
  # leer la tabla de procesos del runner.
  GPG_ARGS+=(--pinentry-mode loopback --passphrase-fd 0)
fi

# Corre `gpg` con las credenciales de la sesión.
gpg_run() {
  if [[ -n "${PASSPHRASE}" ]]; then
    printf '%s\n' "${PASSPHRASE}" | gpg "${GPG_ARGS[@]}" "$@"
  else
    gpg "${GPG_ARGS[@]}" "$@"
  fi
}

# --- dónde están los artefactos -------------------------------------------

PLATFORM_DIR="${STAGE}/${OS}/${ARCH}"
[[ -d "${PLATFORM_DIR}" ]] || die "No artifacts for ${OS}/${ARCH} under ${STAGE}"

CHECKSUM_DIR="${PLATFORM_DIR}/checksums"
KEYRING_DIR="${PLATFORM_DIR}/keyring"
mkdir -p "${CHECKSUM_DIR}" "${KEYRING_DIR}"

# Los instaladores de la plataforma, sin sus firmas ni sus recibos.
#
# Las carpetas de assets —`checksums/` y `keyring/`— quedan fuera: los
# checksums y el keyring publicado son **consecuencia** de firmar los
# instaladores, no instaladores. Si se firmaran a sí mismos, cada
# firma cambiaría el fichero que describe y la firma anterior dejaría
# de cuadrar.
mapfile -t ARTIFACTS < <(
  find "${PLATFORM_DIR}" -mindepth 2 -maxdepth 2 -type f \
    ! -name '*.sig' ! -name '*.signature.json' \
    ! -path "${PLATFORM_DIR}/checksums/*" \
    ! -path "${PLATFORM_DIR}/keyring/*" | LC_ALL=C sort
)

[[ ${#ARTIFACTS[@]} -gt 0 ]] || die "No artifacts found under ${PLATFORM_DIR}"

note "Signing ${#ARTIFACTS[@]} artifact(s) for ${OS}/${ARCH}"

# --- la clave y su keyring publicado ---------------------------------------
#
# La importación es **explícita**: el fichero que dice
# `TANIT_SIGN_GPG_KEYRING` es la única fuente de la clave. Si no está,
# el script muere aquí —y es lo correcto: una release sin `.deb`
# firmado no es una release firmada.

if ! gpg_run --import "${KEYRING_SOURCE}" >/dev/null; then
  die "The GPG keyring could not be imported: ${KEYRING_SOURCE}"
fi

KEY_FINGERPRINT="$(gpg --list-keys --with-colons "${KEY_ID}" 2>/dev/null | awk -F: '/^fpr:/ {print $10; exit}')"
[[ -n "${KEY_FINGERPRINT}" ]] || die "The signing key '${KEY_ID}' was not found in the imported keyring"

SIGNER="$(gpg --list-keys --with-colons "${KEY_ID}" 2>/dev/null | awk -F: '/^uid:/ {print $10; exit}')"
[[ -n "${SIGNER}" ]] || SIGNER="${KEY_ID}"

KEYRING_FILE="${KEYRING_DIR}/${PUBLISHED_KEYRING_NAME}"
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

gpg_run --detach-sign --output "${CHECKSUM_FILE}.sig" --local-user "${KEY_ID}" "${CHECKSUM_FILE}"
note "Signed: $(basename "${CHECKSUM_FILE}.sig")"

# El recibo de los checksums. Los checksums son un asset **firmado**,
# y sin este recibo el manifest no puede decir quién los firmó: la
# firma se produciría y se publicaría sin que nadie la comprobara.
cat > "${CHECKSUM_FILE}.signature.json" <<EOF
{
  "kind": "gpg-detached",
  "signer": "$(json_escape "${SIGNER}")",
  "keyId": "$(json_escape "${KEY_FINGERPRINT}")",
  "timestamped": false,
  "sha256": "$(sha256_of "${CHECKSUM_FILE}")"
}
EOF

for artifact in "${ARTIFACTS[@]}"; do
  gpg_run --detach-sign --output "${artifact}.sig" --local-user "${KEY_ID}" "${artifact}"
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
