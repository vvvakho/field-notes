# Field Notes

Capture on site with your phone. Ask later — get answers with cited video, transcript, and frames.

---

## The problem

AI adoption is racing ahead in software and knowledge work — chat, docs, tickets, meetings. Most of that assumes the world already lives as text.

**Physical businesses don’t.** Construction, manufacturing, energy, facilities, and trades run on sites, equipment, measurements, and things you have to *see*. Operators walk jobs with a phone: they inspect panels, open hatches, call out parts, notice what’s wrong. The valuable record is messy video + voice + context — not a clean CRM field.

Voice-only tools miss the visual evidence. Camera-roll footage isn’t searchable. So the “AI layer” never reaches the people who do the work, and field knowledge stays trapped in one head or one phone.

## What Field Notes is

Field Notes is how AI shows up for operators in the physical world: a **field knowledge bank** built from capture, not from forms.

1. **Capture** — open the app and record. Video + mic + phone sensors (location, time, device). Narrate or stay silent. Offline-first: saves on device, syncs when the network is back. The operator UX is just *capture, capture, capture*.
2. **Index** — video goes to media storage; the product builds **rich metadata** from it: transcript, sparse visual events, searchable chunks (not a raw dump of every frame).
3. **Ask** — type a normal question. Get a short operational answer with **citations**: day, job title, transcript quote, frame still, and a playable clip from that timestamp.

Personal bank first; same substrate can become crew / company knowledge later.

### Demo UX (what you show on stage)

| Tab | Job |
|-----|-----|
| **Capture** | Walk and record. That’s the whole operator UX. |
| **Library** | See indexed jobs / captures. |
| **Ask** | Chip questions or free text → answer + source cards. |

Suggested questions:

- *What work did we do this week?*
- *What supplies do I need to buy?*
- *Who do I need to circle back to?*

---

## Example bank included

This repo ships with **four indexed example jobs** so Ask works before you record anything:

| Note ID | Title | What’s in it |
|---------|--------|----------------|
| `job_panel_assessment` | Electrical panel assessment | Rusted panels, wiring notes, basement / utility walk |
| `job_sandiego_upgrade` | San Diego panel upgrade | Panel upgrade job walkthrough |
| `job_crv_oil_first5` | Honda CR-V oil change (first 5 min) | Automotive bay / oil change start |
| `job_crv_oil_last5` | Honda CR-V oil change (last 5 min) | Finish / close-out of the same job |

Bundled under `data/`:

- `data/videos/job_*.mp4` — compressed demo clips  
- `data/notes/job_*.json` — transcript, events, `index_chunks`  
- `data/frames/job_*/` — sparse stills used as citation previews  

After starting the API, `GET /notes` should list these ready notes. Record a new clip on your phone to prove live capture → sync → ask.

---

## How it works (MVP pipeline)

```text
Phone capture (video + audio + sensors)
        │
        ▼
   Sync when online ──► POST /ingest
        │
        ├─ compress (~480p / 15fps)
        ├─ sparse frames (~every 10s)
        ├─ Gemini: transcript + visual events
        └─ index_chunks → note JSON (+ video + frames on disk)
        │
        ▼
   POST /ask  ──► retrieve chunks across the bank ──► cited answer
```

Video stays in media storage; the **queryable product** is the metadata bank.

---

## Quick start

### Requirements

- Node 20+  
- [ffmpeg](https://ffmpeg.org/) on your PATH  
- Google Cloud project with **Vertex AI** + Application Default Credentials  
- iPhone (or simulator) with **Expo Go** for the on-device demo  

### 1. Clone & env

```bash
git clone https://github.com/vvvakho/field-notes.git
cd field-notes
cp .env.example .env
```

Edit `.env`:

- Set `GOOGLE_CLOUD_PROJECT` to your GCP project  
- Set `EXPO_PUBLIC_API_URL` to `http://YOUR_LAN_IP:8787` for a physical phone (Expo Go cannot use `localhost`)

```bash
# macOS LAN IP
ipconfig getifaddr en0
```

Auth (Vertex / ADC — do **not** set `GEMINI_API_KEY`; that routes to AI Studio prepaid):

```bash
gcloud config set project YOUR_PROJECT
gcloud services enable aiplatform.googleapis.com
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT
```

### 2. API server

```bash
cd server && npm install
set -a && source ../.env && set +a
unset GEMINI_API_KEY GOOGLE_API_KEY
npm run dev
```

Health check: [http://127.0.0.1:8787/health](http://127.0.0.1:8787/health)

### 3. Mobile app (Expo Go)

```bash
# repo root
npm install
export EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8787
npx expo start --lan
```

Scan the QR code with Expo Go (same Wi‑Fi as the Mac).

### 4. Try Ask without recording

With the server up and example notes present:

```bash
curl -s http://127.0.0.1:8787/ask \
  -H 'content-type: application/json' \
  -d '{"question":"What work did we do this week?"}' | python3 -m json.tool
```

Optional: re-ingest demo source clips (if you add `test-*-clip.mp4` locally):

```bash
bash scripts/reprocess-demos.sh
```

---

## Repo layout

```text
App.tsx                 Expo tabs (Ask / Capture / Library)
src/                    Mobile UI + offline note store + sync
server/                 Hono API: /ingest, /ask, /notes, /media, /frames
data/videos/job_*.mp4   Example media
data/notes/job_*.json   Example indexed metadata
data/frames/job_*/      Example citation stills
scripts/                Demo reprocess helpers
```

## Stack

- **App:** Expo SDK 57, TypeScript, Expo Camera / AV / Location  
- **API:** Hono, `@google/genai` on **Vertex AI**, ffmpeg  
- **Retrieval:** lexical chunk bank (embeddings later)  

## Hackathon status

End-to-end demo works: capture → index → ask with citations. Intentionally stubbed for speed: continuous all-day capture, production S3/GCS, multi-user company spaces, embedding RAG.

---

## License

See [LICENSE](./LICENSE).
