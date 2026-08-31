#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PLUGIN_ROOT="$HERMES_HOME/plugins"
DEST="$PLUGIN_ROOT/hermes-worker-studio"
THEME_DIR="$HERMES_HOME/dashboard-themes"
TMP="$PLUGIN_ROOT/.hermes-worker-studio.install.$$"
BACKUP="$PLUGIN_ROOT/.hermes-worker-studio.backup.$$"
CANDIDATE_SHA="${HWS_CANDIDATE_SHA:-}"
if [[ -z "$CANDIDATE_SHA" ]] && command -v git >/dev/null 2>&1; then
  CANDIDATE_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
fi
if [[ -z "$CANDIDATE_SHA" ]]; then
  CANDIDATE_SHA="unversioned-install"
fi

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

for file in \
  plugin.yaml __init__.py schemas.py tools.py \
  dashboard/manifest.json dashboard/plugin_api.py dashboard/plugin_api_v3.py \
  dashboard/dist/index-v3.js dashboard/dist/product.css; do
  if [[ ! -f "$ROOT/$file" ]]; then
    echo "missing required file: $file" >&2
    exit 1
  fi
done

mkdir -p "$PLUGIN_ROOT" "$THEME_DIR"
rm -rf "$TMP" "$BACKUP"
mkdir -p "$TMP/dashboard/dist"
cp "$ROOT/plugin.yaml" "$ROOT/__init__.py" "$ROOT/schemas.py" "$ROOT/tools.py" "$TMP/"
cp "$ROOT/dashboard/manifest.json" "$ROOT/dashboard/plugin_api.py" "$ROOT/dashboard/plugin_api_v3.py" "$TMP/dashboard/"
cp "$ROOT/dashboard/dist/index-v3.js" "$ROOT/dashboard/dist/product.css" "$TMP/dashboard/dist/"

# Product 3 must visually remain inside the Hermes family. The official Hermes
# Web Dashboard already ships its canonical favicon at /favicon.ico. Rewrite
# only the staged product bundle's favicon assignment to reuse that same-origin
# official asset instead of shipping a second independent brand mark.
#
# The staged Product 3 API bridge is also stamped with the exact git candidate
# being installed. Real-target seal evidence reads this value back through the
# public product-capabilities endpoint, so CI, target execution, and browser
# evidence can be cryptographically tied to one commit rather than merely to
# the semantic version.
python - "$TMP/dashboard/dist/index-v3.js" "$TMP/dashboard/plugin_api_v3.py" "$CANDIDATE_SHA" <<'PY'
from pathlib import Path
import sys

bundle = Path(sys.argv[1])
bridge = Path(sys.argv[2])
candidate = sys.argv[3]

text = bundle.read_text(encoding="utf-8")
old = "    const href = `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`;"
new = "    const href = baseHref('/favicon.ico');"
if text.count(old) != 1:
    raise SystemExit("could not locate the unique Product 3 favicon assignment")
bundle.write_text(text.replace(old, new), encoding="utf-8")

source = bridge.read_text(encoding="utf-8")
old_candidate = 'BUILD_CANDIDATE_SHA = "source-tree"'
new_candidate = f'BUILD_CANDIDATE_SHA = {candidate!r}'
if source.count(old_candidate) != 1:
    raise SystemExit("could not locate the unique Product 3 candidate marker")
bridge.write_text(source.replace(old_candidate, new_candidate), encoding="utf-8")
PY

if command -v hermes >/dev/null 2>&1; then
  echo "[1/4] Hermes plugin doctor (staged tree)"
  hermes plugins doctor "$TMP" --ci
else
  echo "[1/4] hermes command not found; skipped plugin doctor" >&2
fi

echo "[2/4] Installing plugin atomically"
if [[ -e "$DEST" ]]; then
  mv "$DEST" "$BACKUP"
fi
if ! mv "$TMP" "$DEST"; then
  [[ -e "$BACKUP" ]] && mv "$BACKUP" "$DEST"
  exit 1
fi
rm -rf "$BACKUP"
trap - EXIT

if [[ -f "$ROOT/themes/hermes-worker-studio.yaml" ]]; then
  install -m 0644 "$ROOT/themes/hermes-worker-studio.yaml" "$THEME_DIR/hermes-worker-studio.yaml"
fi

if command -v hermes >/dev/null 2>&1; then
  echo "[3/4] Enabling through Hermes official plugin command"
  hermes plugins enable hermes-worker-studio
  echo "[4/4] Final plugin doctor"
  hermes plugins doctor "$DEST" --ci
else
  echo "[3/4] Enable manually after Hermes is installed: hermes plugins enable hermes-worker-studio"
  echo "[4/4] Then run: hermes plugins doctor '$DEST' --ci"
fi

cat <<EOF

Installed: $DEST
Candidate: $CANDIDATE_SHA
Theme:     $THEME_DIR/hermes-worker-studio.yaml
Branding:  reuses the official Hermes Dashboard /favicon.ico

Runtime contract:
  HERMES_WORKER_STUDIO_API_URL=http://127.0.0.1:8642
  HERMES_WORKER_STUDIO_API_KEY=<same value as API_SERVER_KEY>

Worker/Verifier execution stays inside Hermes through the public
PluginContext.subagent_lifecycle contract. No external worker service or second
execution runtime is required.

Refresh/restart the official Hermes dashboard. Worker Studio owns the product
home route through official Dashboard tab.override="/". Native /sessions and
other Hermes pages remain reachable from Studio > 高级, with an official
header-left slot providing a return path to Worker Studio. Hermes core files are
never patched.
EOF
