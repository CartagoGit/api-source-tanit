#!/usr/bin/env bash
# Optional development integration: links and verifies the DelendAI install
# that the machine's global `delendai` command runs, the stable channel at
# ~/.local/share/delendai/stable ($DELENDAI_PATH, or $DELENDAI_RUNTIME_DIR,
# names another). The adjacent JSON pin names the version every machine must
# run; an install that is a git checkout is also held to the pinned commit.
#
#   bash scripts/integrations/delendai-runtime.sh --link --verify
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
pin_file="$project_dir/scripts/integrations/delendai-runtime.json"
pin_commit="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).commit)' "$pin_file")"
pin_version="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).version)' "$pin_file")"
runtime_dir="${DELENDAI_RUNTIME_DIR:-${DELENDAI_PATH:-$HOME/.local/share/delendai/stable}}"
fail() { printf 'DelendAI %s: %s\n' "$pin_version" "$1" >&2; exit 1; }
link=false
verify=false
for runtime_arg in "$@"; do
  case "$runtime_arg" in
    --link) link=true ;;
    --verify) verify=true ;;
    *) fail "unknown argument $runtime_arg; use --link and/or --verify." ;;
  esac
done
[[ -f "$runtime_dir/packages/core/package.json" ]] || fail "runtime missing at $runtime_dir; see integrations/delendai/README.md for installation."
runtime_real="$(realpath "$runtime_dir")"
identity="$pin_version"
if [[ "$(git -C "$runtime_real" rev-parse --show-toplevel 2>/dev/null || true)" == "$runtime_real" ]]; then
  actual_commit="$(git -C "$runtime_real" rev-parse HEAD)"
  [[ "$actual_commit" == "$pin_commit" ]] || fail "expected commit $pin_commit; found $actual_commit."
  [[ -z "$(git -C "$runtime_real" status --porcelain --untracked-files=no)" ]] || fail 'runtime has tracked changes; restore its immutable installation.'
  identity="$pin_version $actual_commit"
fi
actual_version="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).version)' "$runtime_real/packages/core/package.json")"
[[ "$actual_version" == "$pin_version" ]] || fail "core version differs: $actual_version."
core_link="$project_dir/integrations/delendai/node_modules/@delendai/core"
if [[ "$link" == true ]]; then
  mkdir -p "$(dirname -- "$core_link")"
  [[ ! -e "$core_link" || -L "$core_link" ]] || fail 'core dependency is a directory; replace it explicitly before linking.'
  ln -sfn "$runtime_real/packages/core" "$core_link"
fi
resolved_core="$(realpath "$core_link" 2>/dev/null || true)"
[[ "$resolved_core" == "$(realpath "$runtime_real/packages/core")" ]] || fail 'integration core does not resolve to the pinned runtime; run this script with --link.'
if [[ "$verify" == true ]]; then
  printf 'DelendAI %s\n' "$identity"
fi
