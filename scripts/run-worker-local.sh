#!/usr/bin/env bash
set -euo pipefail

CWD_REPO="${CWD_REPO:-}"
if [[ -z "$CWD_REPO" ]]; then
  echo "CWD_REPO must point to the codex-worker-delegation checkout" >&2
  exit 2
fi
if [[ ! -f "$CWD_REPO/package.json" || ! -f "$CWD_REPO/src/server.mjs" ]]; then
  echo "CWD_REPO is not a codex-worker-delegation checkout: $CWD_REPO" >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node >=20 is required" >&2
  exit 2
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "node >=20 is required (found $(node -v))" >&2
  exit 2
fi

export CWD_HOST=127.0.0.1
export CWD_PORT="${CWD_PORT:-8788}"
export CWD_REQUIRE_AUTH=0
export CWD_ALLOW_DANGER_FULL_ACCESS=1

# Explicitly keep this convenience launcher loopback-only. Public deployments
# should use codex-worker-delegation's own hardened service/install path with
# authentication rather than weakening this script.
if [[ "$CWD_HOST" != "127.0.0.1" ]]; then
  echo "refusing non-loopback CWD_HOST" >&2
  exit 3
fi

cd "$CWD_REPO"
echo "Starting codex-worker-delegation on http://127.0.0.1:$CWD_PORT"
echo "CWD_REQUIRE_AUTH=0 (loopback only)"
echo "CWD_ALLOW_DANGER_FULL_ACCESS=1"
exec npm start
