#!/usr/bin/env bash
# Durable-enough API tunnel for Field Notes demos.
# Keeps cloudflared alive, writes the public URL into .env, and reprints it
# whenever the tunnel URL changes so you can restart Expo once.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
URL_FILE="$ROOT/data/tunnel-url.txt"
LOG_FILE="$ROOT/data/tunnel.log"
mkdir -p "$ROOT/data"

if ! curl -sf --max-time 2 http://127.0.0.1:8787/health >/dev/null; then
  echo "ERROR: API not reachable on :8787 — start the server first:"
  echo "  cd $ROOT/server && set -a && source ../.env && set +a && npm run dev"
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Install cloudflared: brew install cloudflared"
  exit 1
fi

pkill -f 'cloudflared tunnel --url http://127.0.0.1:8787' 2>/dev/null || true
sleep 1

echo "Starting Cloudflare quick tunnel → http://127.0.0.1:8787"
echo "Leave this terminal open for the whole demo. Do not let the Mac sleep."
echo

: >"$LOG_FILE"
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate 2>&1 | tee "$LOG_FILE" &
CF_PID=$!

cleanup() {
  kill "$CF_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | head -1 || true)"
  if [[ -n "$URL" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$URL" ]]; then
  echo "Failed to obtain tunnel URL — see $LOG_FILE"
  exit 1
fi

echo "$URL" >"$URL_FILE"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^EXPO_PUBLIC_API_URL=' "$ENV_FILE"; then
    # portable in-place replace
    tmp="$(mktemp)"
    awk -v u="$URL" 'BEGIN{done=0} /^EXPO_PUBLIC_API_URL=/{print "EXPO_PUBLIC_API_URL=" u; done=1; next} {print} END{if(!done) print "EXPO_PUBLIC_API_URL=" u}' "$ENV_FILE" >"$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    echo "EXPO_PUBLIC_API_URL=$URL" >>"$ENV_FILE"
  fi
else
  echo "EXPO_PUBLIC_API_URL=$URL" >"$ENV_FILE"
fi

echo
echo "════════════════════════════════════════"
echo " API tunnel ready:"
echo "   $URL"
echo
echo " Then restart Expo ONCE:"
echo "   cd $ROOT"
echo "   npx expo start --tunnel"
echo
echo " Keep THIS process running until the demo ends."
echo "════════════════════════════════════════"
echo

# Health-check loop — exit loudly if origin or tunnel dies
while kill -0 "$CF_PID" 2>/dev/null; do
  if ! curl -sf --max-time 3 http://127.0.0.1:8787/health >/dev/null; then
    echo "$(date -u +%H:%M:%S) WARN: local API :8787 unhealthy"
  fi
  if ! curl -sf --max-time 8 "$URL/health" >/dev/null; then
    echo "$(date -u +%H:%M:%S) WARN: public tunnel unhealthy — restart this script + Expo"
  else
    echo "$(date -u +%H:%M:%S) ok  $URL/health"
  fi
  sleep 20
done

echo "cloudflared exited — tunnel is down"
exit 1
