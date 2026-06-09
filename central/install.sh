#!/usr/bin/env bash
# Nova Central — one-command installer (macOS / Linux / WSL / Termux)
# Usage:  bash install.sh
set -e
cd "$(dirname "$0")"
echo "============================================"
echo "   Nova Central — installer"
echo "============================================"
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required. Install it from https://nodejs.org and re-run."; exit 1; }
WR="npx --yes wrangler@latest"

echo "==> Checking Cloudflare login…"
$WR whoami >/dev/null 2>&1 || $WR login

if grep -q REPLACE_WITH_YOUR_KV_NAMESPACE_ID wrangler.jsonc; then
  echo "==> Creating KV namespace…"
  OUT=$($WR kv namespace create KV 2>&1) || { echo "$OUT"; exit 1; }
  ID=$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{32}' | head -1)
  [ -z "$ID" ] && { echo "❌ Could not read the KV id. Output was:"; echo "$OUT"; exit 1; }
  node -e "const fs=require('fs');const f='wrangler.jsonc';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('REPLACE_WITH_YOUR_KV_NAMESPACE_ID',process.argv[1]))" "$ID"
  echo "    ✅ KV namespace: $ID"
else
  echo "==> KV namespace already configured."
fi

echo "==> Deploying nova-central…"
$WR deploy

echo "==> Set your management password (the ADMIN secret). Type it when prompted:"
$WR secret put ADMIN

echo ""
echo "✅ Done! Open the worker URL above and go to /login"
echo "   Then in each Nova panel → Settings set:"
echo "     POOL_API    = <that url>/api/pool"
echo "     Central API = <that url>"
