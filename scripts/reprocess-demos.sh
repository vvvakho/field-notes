#!/usr/bin/env bash
# Reprocess demo job clips through compress → frames → Gemini bank index.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${API_URL:-http://127.0.0.1:8787}"

ingest() {
  local id="$1" title="$2" captured="$3" lat="$4" lng="$5" file="$6"
  echo "==> ingest $id"
  curl -sS --max-time 120 -X POST "$API/ingest" \
    -F "note_id=$id" \
    -F "title=$title" \
    -F "demo_label=Example from the job" \
    -F "sensors={\"captured_at\":\"$captured\",\"timezone_offset_minutes\":-240,\"geo\":{\"latitude\":$lat,\"longitude\":$lng,\"altitude\":null,\"accuracy\":12,\"heading\":null,\"speed\":0},\"device\":{\"brand\":\"Apple\",\"model_name\":\"Demo\",\"os_name\":\"iOS\",\"os_version\":\"18\"}}" \
    -F "video=@${file};type=video/mp4" \
    -o "/tmp/${id}.json" -w "HTTP %{http_code}\n"
  echo "… waiting for indexing…"
  for _ in $(seq 1 60); do
    sleep 3
    curl -sS "$API/notes/$id" -o "/tmp/${id}.json" || true
    python3 - <<PY
import json,sys
d=json.load(open("/tmp/${id}.json"))
st=d.get("status")
print(" status:", st)
if st in ("ready","error"):
  print(" title:", d.get("title"))
  print(" transcript:", len(d.get("transcript") or []), "events:", len(d.get("events") or []), "chunks:", len(d.get("index_chunks") or []))
  print(" media:", d.get("media"))
  print(" summary:", (d.get("summary") or "")[:180])
  if st=="error":
    print(" error:", d.get("error_message"))
    sys.exit(2)
  sys.exit(0)
sys.exit(1)
PY
    case $? in
      0) return 0 ;;
      2) return 1 ;;
    esac
  done
  echo "timed out waiting for $id"
  return 1
}

curl -s "$API/health" | python3 -m json.tool

ingest "job_panel_assessment" "Electrical panel assessment" "2026-07-22T15:00:00.000Z" 41.7151 44.8271 \
  "$ROOT/data/videos/test-panel-clip.mp4"

echo "… pausing to avoid Gemini 429 …"
sleep 8

ingest "job_sandiego_upgrade" "San Diego panel upgrade" "2026-07-21T16:30:00.000Z" 32.7157 -117.1611 \
  "$ROOT/data/videos/test-sandiego-clip.mp4"

echo "==> bank"
curl -s "$API/notes" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["notes"]),"notes");
[print("-",n.get("title"),n["note_id"],"chunks",len(n.get("index_chunks") or []),"frames", (n.get("media") or {}).get("frame_count")) for n in d["notes"]]'
