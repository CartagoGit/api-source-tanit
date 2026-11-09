#!/usr/bin/env bash
# Optional development integration. Never falls back to a moving checkout.
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
pin_file="$project_dir/scripts/integrations/delendai-runtime.json"
pin_commit="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).commit)' "$pin_file")"
pin_version="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).version)' "$pin_file")"
runtime_dir="${DELENDAI_RUNTIME_DIR:-$HOME/.local/share/tanit/delendai/$pin_version-${pin_commit:0:8}}"
runtime_args=()
for runtime_arg in "$@"; do
  case "$runtime_arg" in
    --version=*) [[ "${runtime_arg#--version=}" == "$pin_version" ]] || { printf 'Unsupported DelendAI runtime version: %s\n' "$runtime_arg" >&2; exit 1; } ;;
    *) runtime_args+=("$runtime_arg") ;;
  esac
done
set -- "${runtime_args[@]}"
fail() { printf 'DelendAI %s: %s\n' "$pin_version" "$1" >&2; exit 1; }
[[ -f "$runtime_dir/packages/cli/src/index.ts" ]] || fail 'runtime missing; see integrations/delendai/README.md for installation.'
actual_commit="$(git -C "$runtime_dir" rev-parse HEAD)"
[[ "$actual_commit" == "$pin_commit" ]] || fail "expected commit $pin_commit; found $actual_commit."
[[ -z "$(git -C "$runtime_dir" status --porcelain --untracked-files=no)" ]] || fail 'runtime has tracked changes; restore its immutable installation.'
actual_version="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).version)' "$runtime_dir/packages/core/package.json")"
[[ "$actual_version" == "$pin_version" ]] || fail "core version differs: $actual_version."
core_link="$project_dir/integrations/delendai/node_modules/@delendai/core"
if [[ "${1:-}" == '--link' ]]; then
  mkdir -p "$(dirname -- "$core_link")"
  [[ ! -e "$core_link" || -L "$core_link" ]] || fail 'core dependency is a directory; replace it explicitly before linking.'
  ln -sfn "$runtime_dir/packages/core" "$core_link"
  shift
fi
resolved_core="$(realpath "$core_link" 2>/dev/null || true)"
expected_core="$(realpath "$runtime_dir/packages/core")"
[[ "$resolved_core" == "$expected_core" ]] || fail 'integration core does not resolve to the pinned runtime; run this script with --link.'
if [[ "${1:-}" == '--verify' ]]; then
  printf 'DelendAI %s %s\n' "$pin_version" "$actual_commit"
  exit 0
fi
export PATH="$project_dir/scripts/integrations/bin:$PATH"
exec bun "$runtime_dir/packages/cli/src/index.ts" "$@"
