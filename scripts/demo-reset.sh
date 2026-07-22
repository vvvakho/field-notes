#!/usr/bin/env bash
# Reset the public API tunnel only (does NOT start/restart the API server).
# Assumes you already have: npm run dev on :8787
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
URL_FILE="$ROOT/data/tunnel-url.txt"
LOG_FILE="$ROOT/data/tunnel.log"
mkdir -p "$ROOT/data"

if ! curl -sf --max-time 2 http://127.0.0.1:8787/health >/dev/null; then
  echo "API not reachable on :8787 — start it yourself first, then re-run this."
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Install cloudflared: brew install cloudflared"
  exit 1
fi

echo "==> Stopping old Cloudflare quick tunnels…"
pkill -f 'cloudflared tunnel --url http://127.0.0.1:8787' 2>/dev/null || true
pkill -f 'lt --port 8787' 2>/dev/null || true
sleep 1

echo "==> Starting fresh Cloudflare quick tunnel…"
: >"$LOG_FILE"
nohup cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate \
  >"$LOG_FILE" 2>&1 &
echo $! >"$ROOT/data/tunnel.pid"

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | head -1 || true)"
  if [[ -n "$URL" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$URL" ]]; then
  echo "Failed to get tunnel URL — see $LOG_FILE"
  exit 1
fi

echo "$URL" >"$URL_FILE"
tmp="$(mktemp)"
if [[ -f "$ENV_FILE" ]] && grep -q '^EXPO_PUBLIC_API_URL=' "$ENV_FILE"; then
  awk -v u="$URL" 'BEGIN{done=0} /^EXPO_PUBLIC_API_URL=/{print "EXPO_PUBLIC_API_URL=" u; done=1; next} {print} END{if(!done) print "EXPO_PUBLIC_API_URL=" u}' "$ENV_FILE" >"$tmp"
else
  if [[ -f "$ENV_FILE" ]]; then
    cat "$ENV_FILE" >"$tmp"
  fi
  echo "EXPO_PUBLIC_API_URL=$URL" >>"$tmp"
fi
mv "$tmp" "$ENV_FILE"

ok=0
for _ in $(seq 1 30); do
  if curl -sf --max-time 8 "$URL/health" >/dev/null; then
    ok=1
    break
  fi
  sleep 1
done

echo
echo "════════════════════════════════════════════════════"
echo " Fresh tunnel:"
echo "   $URL"
[[ "$ok" -eq 1 ]] || echo "   (health not confirmed yet — wait a few seconds)"
echo
echo " Restart Expo once (URL changed):"
echo "   cd $ROOT && npx expo start --tunnel"
echo
echo " Browser fallback (no tunnel):"
echo "   cd $ROOT && EXPO_PUBLIC_API_URL=http://127.0.0.1:8787 npx expo start --web"
echo "════════════════════════════════════════════════════"
