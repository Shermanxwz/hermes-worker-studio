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
  dashboard/dist/gateway-native.js dashboard/dist/index-v3.js \
  dashboard/dist/project-mark.png dashboard/dist/product.css dashboard/dist/product-sealed.css \
  scripts/stage_product_bundle.py; do
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
cp "$ROOT/dashboard/dist/gateway-native.js" "$ROOT/dashboard/dist/index-v3.js" "$ROOT/dashboard/dist/project-mark.png" "$ROOT/dashboard/dist/product.css" "$ROOT/dashboard/dist/product-sealed.css" "$TMP/dashboard/dist/"

# Product 3 uses one project mark across its plugin UI. The image
# is served by Hermes' official plugin static-asset route, so the browser never
# needs a second branding transport or a data-URI copy.
#
# The staged Product 3 API bridge is also stamped with the exact git candidate
# being installed. Real-target seal evidence reads this value back through the
# public product-capabilities endpoint, so CI, target execution, and browser
# evidence can be cryptographically tied to one commit rather than merely to
# the semantic version.
python3 - "$TMP/dashboard/dist/index-v3.js" "$TMP/dashboard/plugin_api_v3.py" "$CANDIDATE_SHA" <<'PY'
from pathlib import Path
import sys

bundle = Path(sys.argv[1])
bridge = Path(sys.argv[2])
candidate = sys.argv[3]

source = bridge.read_text(encoding="utf-8")
old_candidate = 'BUILD_CANDIDATE_SHA = "source-tree"'
new_candidate = f'BUILD_CANDIDATE_SHA = {candidate!r}'
if source.count(old_candidate) != 1:
    raise SystemExit("could not locate the unique Product 3 candidate marker")
bridge.write_text(source.replace(old_candidate, new_candidate), encoding="utf-8")
PY

# Widen the release Composer to the pinned Hermes Gateway's official attachment
# family (image.attach_bytes / pdf.attach / file.attach). The transform itself
# is exact-count checked and fails closed if Product 3 source drifts.
python3 "$ROOT/scripts/stage_product_bundle.py" "$TMP/dashboard/dist/index-v3.js"

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
Branding:  project mark via Hermes official plugin static assets

Runtime contract:
  Product chat: Hermes official TUI Gateway JSON-RPC over Dashboard WebSocket (/api/ws)
  Probe/CI:     HERMES_WORKER_STUDIO_API_URL=http://127.0.0.1:8642
                HERMES_WORKER_STUDIO_API_KEY=<same value as API_SERVER_KEY>

Chat/session runtime state, Context usage, Auto Compact lifecycle, canonical todo,
steer/interrupt, no-wait Full Access input handling, and arbitrary attachments are
consumed from official Hermes Gateway methods/events. Attachments use
image.attach_bytes / pdf.attach / file.attach; ordinary files use Hermes-returned
@file: references. WebSocket reconnects resume durable Hermes Sessions instead of
terminating work. /v1/runs remains a probe/CI/unattended surface rather than the
product chat transport.

Worker/Verifier execution stays inside Hermes through the public
PluginContext.subagent_lifecycle contract. No external worker service or second
execution runtime is required.

Refresh/restart the official Hermes dashboard. Worker Studio owns the product
home route through official Dashboard tab.override="/". The Studio Advanced
link goes directly to Hermes' native /sessions shell, whose own sidebar owns
all native navigation and future Hermes additions; official header-left/sidebar
slots provide return paths to Worker Studio. Hermes core files are never patched.
EOF
