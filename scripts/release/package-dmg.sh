#!/usr/bin/env bash
#
# `scripts/release/package-dmg.sh` — el `.dmg` **después** de grapar.
#
# ## Por qué este script existe
#
# Tauri construye el `.app` y el `.dmg` en el mismo paso, así que el
# `.dmg` que sale de `cargo tauri build` lleva dentro un `.app` que
# todavía no está firmado —y, aunque lo estuviera, sin el ticket de
# notarización grapado. Apple rechaza esa imagen: la notarización mira
# **dentro** del `.dmg`, y un bundle sin firma dentro es código sin
# firma.
#
# El orden que Apple documenta es el contrario:
#
#   1. firmar el `.app`
#   2. `notarytool submit --wait` y esperar la aceptación
#   3. `stapler staple`
#   4. **entonces** construir el `.dmg` con el bundle ya grapado
#   5. firmar, notarizar y grapar el `.dmg`
#
# Este script es el paso 4. `hdiutil` es la herramienta del sistema, y
# el resultado es una imagen UDZO con el bundle y un enlace a
# `/Applications`, que es lo que el usuario espera al arrastrar.
#
# ## Lo que NO hace
#
# No firma y no notariza: eso es `sign-macos.sh` y
# `notarize-macos.sh`, y van **después**. Una imagen sin firmar no se
# publica, y una imagen firmada con un bundle dentro sin firmar es
# peor que no publicar nada.
#
# Uso:
#   scripts/release/package-dmg.sh --app <bundle.app> --output <imagen.dmg> [--volume Tanit]
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

APP=""
OUTPUT=""
VOLUME="Tanit"

# --- utilidades ------------------------------------------------------------

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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    --volume) VOLUME="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -n "${APP}" ]] || die "--app is required"
[[ -n "${OUTPUT}" ]] || die "--output is required"
[[ -d "${APP}" ]] || die "The bundle is not a directory: ${APP}"
[[ "${APP}" == *.app ]] || die "The bundle is not an .app: ${APP}"

need_cmd hdiutil
need_cmd ditto

# --- la imagen -------------------------------------------------------------
#
# El volumen se monta en un directorio aparte porque `hdiutil -srcfolder`
# mete **todo** lo que hay dentro: el bundle grapado no puede ir
# acompañado de otra cosa, y el `.app` lleva dentro sus frameworks y sus
# recursos.

STAGE_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${STAGE_DIR}"
}
trap cleanup EXIT

cp -R "${APP}" "${STAGE_DIR}/"

# El enlace a `/Applications` es lo que hace que el usuario arrastre el
# bundle en vez de tener que buscar la carpeta a mano.
ln -s /Applications "${STAGE_DIR}/Applications"

mkdir -p "$(dirname "${OUTPUT}")"
rm -f "${OUTPUT}"

note "Packaging: ${APP} → ${OUTPUT}"
hdiutil create \
  -volname "${VOLUME}" \
  -srcfolder "${STAGE_DIR}" \
  -format UDZO \
  -ov \
  -quiet \
  "${OUTPUT}" || die "hdiutil could not build the image"

[[ -s "${OUTPUT}" ]] || die "The image came out empty: ${OUTPUT}"

note "Done. The image carries the stapled bundle and the /Applications link."
