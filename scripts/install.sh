#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PLUGIN_ROOT="$HERMES_HOME/plugins"
DEST="$PLUGIN_ROOT/hermes-worker-studio"
THEME_DIR="$HERMES_HOME/dashboard-themes"
THEME_DEST="$THEME_DIR/hermes-worker-studio.yaml"
TMP="$PLUGIN_ROOT/.hermes-worker-studio.install.$$"
BACKUP="$PLUGIN_ROOT/.hermes-worker-studio.backup.$$"
THEME_BACKUP="$THEME_DIR/.hermes-worker-studio.yaml.backup.$$"
CANDIDATE_SHA="${HWS_CANDIDATE_SHA:-}"
if [[ -z "$CANDIDATE_SHA" ]] && command -v git >/dev/null 2>&1; then
  CANDIDATE_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
fi
if [[ -z "$CANDIDATE_SHA" ]]; then
  CANDIDATE_SHA="unversioned-install"
fi

SWAP_MODE="none"
ROLLBACK_ARMED=0
HAD_PREVIOUS=0
THEME_CHANGED=0
THEME_HAD_PREVIOUS=0

exchange_dirs() {
  python3 - "$1" "$2" <<'PY'
import ctypes
import os
import sys

left = os.fsencode(sys.argv[1])
right = os.fsencode(sys.argv[2])
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = getattr(libc, "renameat2", None)
if renameat2 is None:
    raise SystemExit(1)
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
AT_FDCWD = -100
RENAME_EXCHANGE = 2
if renameat2(AT_FDCWD, left, AT_FDCWD, right, RENAME_EXCHANGE) != 0:
    raise SystemExit(1)
PY
}

rollback_install() {
  case "$SWAP_MODE" in
    atomic-exchange)
      if [[ -e "$DEST" && -e "$TMP" ]]; then
        if ! exchange_dirs "$TMP" "$DEST"; then
          echo "FATAL: could not atomically restore previous plugin from $TMP" >&2
          return 1
        fi
      fi
      rm -rf "$TMP"
      ;;
    rollback-safe)
      rm -rf "$DEST"
      if (( HAD_PREVIOUS )) && [[ -e "$BACKUP" ]]; then
        mv "$BACKUP" "$DEST"
      fi
      ;;
    new-install)
      rm -rf "$DEST"
      ;;
  esac

  if (( THEME_CHANGED )); then
    if (( THEME_HAD_PREVIOUS )) && [[ -f "$THEME_BACKUP" ]]; then
      install -m 0644 "$THEME_BACKUP" "$THEME_DEST"
    else
      rm -f "$THEME_DEST"
    fi
  fi
}

cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 && ROLLBACK_ARMED )); then
    echo "Install failed after replacement; restoring previous Worker Studio state" >&2
    rollback_install || status=70
  fi
  rm -rf "$TMP"
  rm -rf "$BACKUP"
  rm -f "$THEME_BACKUP"
  exit "$status"
}
trap cleanup EXIT

for file in \
  plugin.yaml __init__.py schemas.py tools.py \
  dashboard/manifest.json dashboard/plugin_api.py dashboard/plugin_api_v3.py \
  dashboard/dist/gateway-native.js dashboard/dist/gateway-native-core.js \
  dashboard/dist/model-capability-core.js dashboard/dist/model-capability-bridge.js dashboard/dist/model-capability-dom.js \
  dashboard/dist/index-v3.js dashboard/dist/project-mark.png dashboard/dist/product.css dashboard/dist/product-sealed.css dashboard/dist/product-closure.css \
  scripts/stage_product_bundle.py scripts/stage_mixed_protocol.py scripts/stage_security_closure.py; do
  if [[ ! -f "$ROOT/$file" ]]; then
    echo "missing required file: $file" >&2
    exit 1
  fi
done

mkdir -p "$PLUGIN_ROOT" "$THEME_DIR"
rm -rf "$TMP" "$BACKUP"
rm -f "$THEME_BACKUP"
mkdir -p "$TMP/dashboard/dist"
cp "$ROOT/plugin.yaml" "$ROOT/__init__.py" "$ROOT/schemas.py" "$ROOT/tools.py" "$TMP/"
cp "$ROOT/dashboard/manifest.json" "$ROOT/dashboard/plugin_api.py" "$ROOT/dashboard/plugin_api_v3.py" "$TMP/dashboard/"
cp "$ROOT/dashboard/dist/index-v3.js" "$ROOT/dashboard/dist/project-mark.png" "$ROOT/dashboard/dist/product.css" "$ROOT/dashboard/dist/product-sealed.css" "$ROOT/dashboard/dist/product-closure.css" "$TMP/dashboard/dist/"

# Source stays split for maintainability, but the one supported installed
# artifact keeps the historical single Gateway-native browser entry. Compose
# capability semantics ahead of the byte-stable native Gateway implementation
# so the installed plugin needs no secondary script files or runtime loader.
cat \
  "$ROOT/dashboard/dist/model-capability-core.js" \
  "$ROOT/dashboard/dist/model-capability-bridge.js" \
  "$ROOT/dashboard/dist/model-capability-dom.js" \
  "$ROOT/dashboard/dist/gateway-native-core.js" \
  > "$TMP/dashboard/dist/gateway-native.js"

# Product 3 uses one project mark across its plugin UI. The image is served by
# Hermes' official plugin static-asset route, so the browser never needs a
# second branding transport or a data-URI copy. Stamp the exact candidate into
# the staged API bridge so CI/target/browser evidence can name one commit.
python3 - "$TMP/dashboard/plugin_api_v3.py" "$CANDIDATE_SHA" <<'PY'
from pathlib import Path
import sys

bridge = Path(sys.argv[1])
candidate = sys.argv[2]
source = bridge.read_text(encoding="utf-8")
old_candidate = 'BUILD_CANDIDATE_SHA = "source-tree"'
new_candidate = f'BUILD_CANDIDATE_SHA = {candidate!r}'
if source.count(old_candidate) != 1:
    raise SystemExit("could not locate the unique Product 3 candidate marker")
bridge.write_text(source.replace(old_candidate, new_candidate), encoding="utf-8")
PY

# Deterministic release transforms are build steps, not alternate runtimes.
# Every transform is exact-count/fail-closed and independently reproduced in CI.
python3 "$ROOT/scripts/stage_product_bundle.py" "$TMP/dashboard/dist/index-v3.js"
python3 "$ROOT/scripts/stage_mixed_protocol.py" \
  "$TMP/dashboard/dist/index-v3.js" \
  "$TMP/dashboard/plugin_api_v3.py"
python3 "$ROOT/scripts/stage_security_closure.py" "$TMP/dashboard/plugin_api_v3.py"

if command -v hermes >/dev/null 2>&1; then
  echo "[1/4] Hermes plugin doctor (staged tree)"
  hermes plugins doctor "$TMP" --ci
else
  echo "[1/4] hermes command not found; skipped plugin doctor" >&2
fi

echo "[2/4] Installing plugin transactionally"
if [[ -e "$DEST" ]]; then
  HAD_PREVIOUS=1
  # Linux filesystems supporting renameat2 can exchange old/new directory
  # names in one namespace operation. Keep the old tree at TMP until every
  # post-swap validation succeeds so rollback is equally atomic.
  if exchange_dirs "$TMP" "$DEST" 2>/dev/null; then
    SWAP_MODE="atomic-exchange"
    ROLLBACK_ARMED=1
  else
    # Portable fallback: preserve the old tree before replacement and keep it
    # until final Doctor + enable succeed. Any failure restores it on EXIT.
    mv "$DEST" "$BACKUP"
    SWAP_MODE="rollback-safe"
    ROLLBACK_ARMED=1
    mv "$TMP" "$DEST"
  fi
else
  SWAP_MODE="new-install"
  ROLLBACK_ARMED=1
  mv "$TMP" "$DEST"
fi

if command -v hermes >/dev/null 2>&1; then
  # Validate the exact installed path before mutating enabled-plugin state.
  echo "[3/4] Final plugin doctor"
  hermes plugins doctor "$DEST" --ci
fi

if [[ -f "$ROOT/themes/hermes-worker-studio.yaml" ]]; then
  if [[ -f "$THEME_DEST" ]]; then
    cp -p "$THEME_DEST" "$THEME_BACKUP"
    THEME_HAD_PREVIOUS=1
  fi
  install -m 0644 "$ROOT/themes/hermes-worker-studio.yaml" "$THEME_DEST"
  THEME_CHANGED=1
fi

if command -v hermes >/dev/null 2>&1; then
  echo "[4/4] Enabling through Hermes official plugin command"
  hermes plugins enable hermes-worker-studio
else
  echo "[3/4] Enable manually after Hermes is installed: hermes plugins enable hermes-worker-studio"
  echo "[4/4] Then run: hermes plugins doctor '$DEST' --ci"
fi

# Commit point: the staged tree, exact installed tree, theme write and official
# enable have all succeeded (or Hermes is not installed and the manual gate was
# explicitly printed). Only now discard the rollback copy.
ROLLBACK_ARMED=0
if [[ "$SWAP_MODE" == "atomic-exchange" ]]; then
  rm -rf "$TMP"
fi
rm -rf "$BACKUP"
rm -f "$THEME_BACKUP"
trap - EXIT

cat <<EOF

Installed: $DEST
Candidate: $CANDIDATE_SHA
Swap:      $SWAP_MODE
Theme:     $THEME_DEST
Branding:  project mark via Hermes official plugin static assets

Runtime contract:
  Product chat: Hermes official TUI Gateway JSON-RPC over Dashboard WebSocket (/api/ws)
  Probe/CI:     HERMES_WORKER_STUDIO_API_URL=http://127.0.0.1:8642
                HERMES_WORKER_STUDIO_API_KEY=<same value as API_SERVER_KEY>

Model capabilities are normalized from Hermes' official model inventory inside
the single staged gateway-native.js artifact. Non-Auto reasoning overrides are
validated against the exact Provider+Model capability and fail closed before
Gateway config.set/prompt submission; no model-name capability registry exists.

Chat/session runtime state, Context usage, Auto Compact lifecycle, canonical todo,
steer/interrupt, no-wait Full Access input handling, and arbitrary attachments are
consumed from official Hermes Gateway methods/events. Attachments use
image.attach_bytes / pdf.attach / file.attach; ordinary files use Hermes-returned
@file: references. WebSocket reconnects resume durable Hermes Sessions instead of
terminating work. /v1/runs remains a probe/CI/unattended surface rather than the
product chat transport. Mixed custom endpoints are resolved per model on first
real use by Hermes Runs; Chat/Responses decisions are cached and never guessed
from model names. Staged private state writes are created mode 0600 before rename,
and malformed JSON request bodies fail closed as HTTP 400.

Worker/Verifier execution stays inside Hermes through the public
PluginContext.subagent_lifecycle contract. Independent Worker/Verifier routes and
native MOA slots resolve through the same per-model execution route as product
chat. No external worker service or second execution runtime is required.

Refresh/restart the official Hermes dashboard. Worker Studio owns the product
home route through official Dashboard tab.override="/". The Studio Advanced
link goes directly to Hermes' native /sessions shell, whose own sidebar owns
all native navigation and future Hermes additions; official header-left/sidebar
slots provide return paths to Worker Studio. Hermes core files are never patched.
EOF
