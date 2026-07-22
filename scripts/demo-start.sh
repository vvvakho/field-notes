#!/usr/bin/env bash
# Full Field Notes demo restart (no Expo/ngrok tunnel — Cloudflare only):
#   1) wipe old tunnels + ports 8787/8081/8082
#   2) start API on :8787 + Cloudflare tunnel (phone API)
#   3) start web on :8082
#   4) start Metro on :8081 + Cloudflare tunnel (phone JS bundle)
#   5) reopen Metro with EXPO_PACKAGER_PROXY_URL so QR works in Expo Go
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
LOG_DIR="$ROOT/data"
mkdir -p "$LOG_DIR"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "==> Killing listeners on :$port ($pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

wait_url_in_log() {
  local log="$1"
  local url=""
  for _ in $(seq 1 60); do
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1 || true)"
    if [[ -n "$url" ]]; then
      echo "$url"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

echo "==> Stopping old demo processes…"
pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
pkill -f 'lt --port 8787' 2>/dev/null || true
kill_port 8787
kill_port 8081
kill_port 8082
sleep 1

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy .env.example first"
  exit 1
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Install cloudflared: brew install cloudflared"
  exit 1
fi

echo "==> Starting API on :8787…"
(
  cd "$ROOT/server"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  unset GEMINI_API_KEY GOOGLE_API_KEY || true
  nohup npm run dev >"$LOG_DIR/api.log" 2>&1 &
  echo $! >"$LOG_DIR/api.pid"
)
for _ in $(seq 1 40); do
  curl -sf --max-time 2 http://127.0.0.1:8787/health >/dev/null && break
  sleep 0.5
done
if ! curl -sf --max-time 2 http://127.0.0.1:8787/health >/dev/null; then
  echo "API failed to start — see $LOG_DIR/api.log"
  exit 1
fi
echo "==> API healthy"

echo "==> Cloudflare tunnel for API (:8787)…"
: >"$LOG_DIR/tunnel-api.log"
nohup cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate \
  >"$LOG_DIR/tunnel-api.log" 2>&1 &
echo $! >"$LOG_DIR/tunnel-api.pid"
API_URL="$(wait_url_in_log "$LOG_DIR/tunnel-api.log" || true)"
if [[ -z "${API_URL:-}" ]]; then
  echo "Failed API tunnel URL — see $LOG_DIR/tunnel-api.log"
  exit 1
fi
echo "$API_URL" >"$LOG_DIR/tunnel-url.txt"
tmp="$(mktemp)"
awk -v u="$API_URL" 'BEGIN{done=0} /^EXPO_PUBLIC_API_URL=/{print "EXPO_PUBLIC_API_URL=" u; done=1; next} {print} END{if(!done) print "EXPO_PUBLIC_API_URL=" u}' "$ENV_FILE" >"$tmp"
mv "$tmp" "$ENV_FILE"
echo "==> API tunnel: $API_URL"

echo "==> Starting web client on :8082…"
(
  cd "$ROOT"
  export EXPO_PUBLIC_API_URL="$API_URL"
  nohup npx expo start --web --port 8082 >"$LOG_DIR/web.log" 2>&1 &
  echo $! >"$LOG_DIR/web.pid"
)

echo "==> Warming Metro on :8081 (LAN)…"
(
  cd "$ROOT"
  export EXPO_PUBLIC_API_URL="$API_URL"
  nohup npx expo start --lan --port 8081 >"$LOG_DIR/metro-boot.log" 2>&1 &
  echo $! >"$LOG_DIR/metro-boot.pid"
)
for _ in $(seq 1 60); do
  curl -sf --max-time 2 http://127.0.0.1:8081/status >/dev/null && break
  sleep 0.5
done
if ! curl -sf --max-time 2 http://127.0.0.1:8081/status >/dev/null; then
  echo "Metro failed to start — see $LOG_DIR/metro-boot.log"
  exit 1
fi

echo "==> Cloudflare tunnel for Metro (:8081)…"
: >"$LOG_DIR/tunnel-metro.log"
nohup cloudflared tunnel --url http://127.0.0.1:8081 --no-autoupdate \
  >"$LOG_DIR/tunnel-metro.log" 2>&1 &
echo $! >"$LOG_DIR/tunnel-metro.pid"
METRO_URL="$(wait_url_in_log "$LOG_DIR/tunnel-metro.log" || true)"
if [[ -z "${METRO_URL:-}" ]]; then
  echo "Failed Metro tunnel URL — see $LOG_DIR/tunnel-metro.log"
  exit 1
fi
echo "$METRO_URL" >"$LOG_DIR/metro-tunnel-url.txt"
echo "==> Metro tunnel: $METRO_URL"

echo "==> Restarting Metro with EXPO_PACKAGER_PROXY_URL (QR via Cloudflare, not ngrok)…"
kill_port 8081
sleep 1

echo
echo "════════════════════════════════════════════════════"
echo " Background:"
echo "   API        http://127.0.0.1:8787"
echo "   API tunnel $API_URL"
echo "   Web        http://localhost:8082"
echo "   Metro CF   $METRO_URL"
echo
echo " Phone: scan QR below, or in Expo Go enter:"
echo "   exp://${METRO_URL#https://}:80"
echo "════════════════════════════════════════════════════"
echo

cd "$ROOT"
export EXPO_PUBLIC_API_URL="$API_URL"
export EXPO_PACKAGER_PROXY_URL="$METRO_URL"
exec npx expo start --lan --port 8081
