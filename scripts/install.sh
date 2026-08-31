#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PLUGIN_ROOT="$HERMES_HOME/plugins"
DEST="$PLUGIN_ROOT/hermes-worker-studio"
THEME_DIR="$HERMES_HOME/dashboard-themes"
TMP="$PLUGIN_ROOT/.hermes-worker-studio.install.$$"
BACKUP="$PLUGIN_ROOT/.hermes-worker-studio.backup.$$"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

for file in plugin.yaml __init__.py schemas.py tools.py dashboard/manifest.json dashboard/plugin_api.py dashboard/dist/index.js dashboard/dist/style.css; do
  if [[ ! -f "$ROOT/$file" ]]; then
    echo "missing required file: $file" >&2
    exit 1
  fi
done

mkdir -p "$PLUGIN_ROOT" "$THEME_DIR"
rm -rf "$TMP" "$BACKUP"
mkdir -p "$TMP/dashboard/dist"
cp "$ROOT/plugin.yaml" "$ROOT/__init__.py" "$ROOT/schemas.py" "$ROOT/tools.py" "$TMP/"
cp "$ROOT/dashboard/manifest.json" "$ROOT/dashboard/plugin_api.py" "$TMP/dashboard/"
cp "$ROOT/dashboard/dist/index.js" "$ROOT/dashboard/dist/style.css" "$TMP/dashboard/dist/"

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
Theme:     $THEME_DIR/hermes-worker-studio.yaml

Runtime contract:
  HERMES_WORKER_STUDIO_API_URL=http://127.0.0.1:8642
  HERMES_WORKER_STUDIO_API_KEY=<same value as API_SERVER_KEY>

Worker/Verifier execution stays inside Hermes through the public
PluginContext.subagent_lifecycle contract. No external worker service or second
execution runtime is required.

Refresh/restart the official Hermes dashboard. /sessions is replaced through
the official Dashboard Plugin SDK; Hermes core files are never patched.
EOF
