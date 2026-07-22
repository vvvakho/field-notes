#!/usr/bin/env bash
# Creates a Gemini API key on your GFS GCP project and writes ../.env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
DISPLAY_NAME="${DISPLAY_NAME:-field-notes-gemini}"
NAME_FILTER="${NAME_FILTER:-GFS Cloud Program}"

echo "==> Checking gcloud auth…"
if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "gcloud session expired. In your own terminal run:"
  echo "  gcloud auth login"
  echo "Then:"
  echo "  bash scripts/setup-gemini-env.sh"
  exit 1
fi

if [[ -n "${PROJECT_ID:-}" ]]; then
  echo "==> Using PROJECT_ID from env: ${PROJECT_ID}"
else
  echo "==> Finding project matching: ${NAME_FILTER}"
  PROJECT_ID="$(
    gcloud projects list \
      --filter="name~'${NAME_FILTER}' AND lifecycleState=ACTIVE" \
      --format='value(projectId)' \
      --limit=1
  )"
fi

if [[ -z "${PROJECT_ID}" ]]; then
  echo "No matching project. Listing projects:"
  gcloud projects list --format='table(projectId,name)' || true
  echo
  echo "Re-run with:  PROJECT_ID=your-project-id bash scripts/setup-gemini-env.sh"
  exit 1
fi

echo "==> Project: ${PROJECT_ID}"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling generativelanguage.googleapis.com…"
gcloud services enable generativelanguage.googleapis.com --project="$PROJECT_ID"

echo "==> Creating API key (${DISPLAY_NAME})…"
set +e
CREATE_OUT="$(
  gcloud beta services api-keys create \
    --display-name="$DISPLAY_NAME" \
    --api-target=service=generativelanguage.googleapis.com \
    --project="$PROJECT_ID" \
    --format=json 2>&1
)"
STATUS=$?
if [[ $STATUS -ne 0 ]]; then
  CREATE_OUT="$(
    gcloud alpha services api-keys create \
      --display-name="$DISPLAY_NAME" \
      --api-target=service=generativelanguage.googleapis.com \
      --project="$PROJECT_ID" \
      --format=json 2>&1
  )"
  STATUS=$?
fi
set -e

if [[ $STATUS -ne 0 ]]; then
  echo "gcloud api-keys create failed:"
  echo "$CREATE_OUT"
  echo
  echo "Fallback: create a key in the console, then paste into .env"
  echo "  https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
  echo "  or https://aistudio.google.com/apikey (select this GCP project)"
  exit 1
fi

KEY="$(
  python3 - <<'PY' <<<"$CREATE_OUT"
import json, re, sys
raw = sys.stdin.read()
m = re.search(r"AIza[0-9A-Za-z\-_]{20,}", raw)
if m:
    print(m.group(0))
    raise SystemExit
try:
    d = json.loads(raw)
except Exception:
    print("")
    raise SystemExit

def find(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ("keyString", "key_string") and isinstance(v, str) and v.startswith("AIza"):
                return v
            r = find(v)
            if r:
                return r
    elif isinstance(o, list):
        for i in o:
            r = find(i)
            if r:
                return r
    return ""

print(find(d))
PY
)"

if [[ -z "$KEY" ]]; then
  echo "Key created but keyString missing from CLI output."
  echo "$CREATE_OUT"
  echo
  echo "Copy the key from:"
  echo "  https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
  exit 2
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '127.0.0.1')"

umask 077
cat > "$ENV_FILE" <<EOF
GEMINI_API_KEY=${KEY}
GEMINI_MODEL=gemini-2.5-flash
PORT=8787
EXPO_PUBLIC_API_URL=http://${LAN_IP}:8787
GCP_PROJECT_ID=${PROJECT_ID}
EOF

echo
echo "Wrote ${ENV_FILE} (permissions locked down)"
echo "Next:"
echo "  cd ${ROOT}/server && set -a && source ../.env && set +a && npm run dev"
