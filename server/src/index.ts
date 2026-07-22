import {
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { GoogleGenAI } from '@google/genai';
import { estimateCost, logModelCost, type CostReport } from './cost.js';
import { buildIndexChunks, retrieveChunks, type IndexChunk } from './retrieve.js';
import { compressVideo, extractSparseFrames } from './media.js';

type GeoPoint = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
};

type CaptureSensors = {
  captured_at: string;
  timezone_offset_minutes: number;
  geo: GeoPoint | null;
  device: {
    brand: string | null;
    model_name: string | null;
    os_name: string | null;
    os_version: string | null;
  };
};

type TranscriptCue = { t: number; text: string };
type FieldEvent = {
  t: number;
  label: string;
  detail?: string;
  frame_hint?: string;
  frame_image?: string;
};

type FieldNote = {
  note_id: string;
  created_at: string;
  title?: string;
  demo_label?: string;
  sensors: CaptureSensors;
  summary: string;
  transcript: TranscriptCue[];
  events: FieldEvent[];
  index_chunks?: IndexChunk[];
  video_path?: string;
  media?: {
    original_bytes?: number;
    compressed_bytes?: number;
    frame_count?: number;
  };
  status: 'local' | 'syncing' | 'ready' | 'error';
  error_message?: string;
};

type AskCitation = {
  note_id: string;
  t: number;
  kind: 'transcript' | 'event' | 'frame';
  quote: string;
  frame_hint?: string;
  day_label?: string;
  source_title?: string;
  demo_label?: string;
  media_url?: string;
  frame_image_url?: string;
};

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA = join(ROOT, 'data');
const VIDEOS = join(DATA, 'videos');
const FRAMES = join(DATA, 'frames');
const NOTES = join(DATA, 'notes');
const COSTS = join(DATA, 'costs');

for (const dir of [DATA, VIDEOS, FRAMES, NOTES, COSTS]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCP_PROJECT_ID ||
  'core-487314';
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const MAX_INLINE_BYTES = Number(process.env.MAX_INLINE_VIDEO_BYTES ?? 16_000_000);
const FRAME_EVERY_SEC = Number(process.env.FRAME_EVERY_SEC ?? 10);

delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  vertexai: true,
  project: PROJECT,
  location: LOCATION,
});

console.log(
  `Gemini via Vertex AI · project=${PROJECT} · location=${LOCATION} · model=${MODEL}`,
);

const app = new Hono();
app.use('*', cors());

app.get('/health', (c) =>
  c.json({
    ok: true,
    auth: 'vertex-adc',
    project: PROJECT,
    location: LOCATION,
    model: MODEL,
    bank_notes: listNotes().length,
  }),
);

app.get('/notes', (c) => c.json({ notes: listNotes() }));

app.get('/media/:note_id', (c) => {
  const note = listNotes().find((n) => n.note_id === c.req.param('note_id'));
  if (!note?.video_path || !existsSync(note.video_path)) {
    return c.text('media not found', 404);
  }
  // iOS AVPlayer (Expo Video) requires real HTTP Range / 206 responses.
  return serveMp4WithRanges(c.req.raw, note.video_path);
});

app.get('/frames/:note_id/:t', (c) => {
  const note_id = c.req.param('note_id');
  const t = Number(c.req.param('t'));
  const path = join(FRAMES, note_id, `t${String(Math.floor(t)).padStart(4, '0')}.jpg`);
  // nearest frame within ±FRAME_EVERY_SEC
  const dir = join(FRAMES, note_id);
  if (!existsSync(dir)) return c.text('frame not found', 404);
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg'));
  let best: string | null = null;
  let bestDist = Infinity;
  for (const f of files) {
    const ft = Number(f.replace(/^t/, '').replace(/\.jpg$/, ''));
    const dist = Math.abs(ft - t);
    if (dist < bestDist) {
      bestDist = dist;
      best = join(dir, f);
    }
  }
  if (!best || bestDist > FRAME_EVERY_SEC + 1) {
    if (existsSync(path)) best = path;
    else return c.text('frame not found', 404);
  }
  const bytes = readFileSync(best);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

app.post('/ingest', async (c) => {
  const form = await c.req.formData();
  const note_id = String(form.get('note_id') ?? '');
  const sensorsRaw = String(form.get('sensors') ?? '');
  const title = String(form.get('title') ?? '').trim() || undefined;
  const demo_label = String(form.get('demo_label') ?? '').trim() || undefined;
  const video = form.get('video');

  if (!note_id || !sensorsRaw || !(video instanceof File)) {
    return c.text('note_id, sensors, and video are required', 400);
  }

  let sensors: CaptureSensors;
  try {
    sensors = JSON.parse(sensorsRaw) as CaptureSensors;
  } catch {
    return c.text('invalid sensors JSON', 400);
  }

  const rawPath = join(VIDEOS, `${note_id}.raw.mp4`);
  const videoPath = join(VIDEOS, `${note_id}.mp4`);
  const bytes = Buffer.from(await video.arrayBuffer());
  await writeFile(rawPath, bytes);

  try {
    const note = await ingestPipeline({
      note_id,
      sensors,
      rawPath,
      videoPath,
      title,
      demo_label,
    });
    const { cost, ...persisted } = note;
    saveNote(persisted);
    return c.json({ ...persisted, cost });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ingest failed';
    console.error('ingest error:', message);
    return c.text(message, 500);
  } finally {
    if (existsSync(rawPath)) {
      try {
        unlinkSync(rawPath);
      } catch {
        // ignore
      }
    }
  }
});

app.post('/ask', async (c) => {
  const body = await c.req.json<{ question?: string }>();
  const question = body.question?.trim();
  if (!question) return c.text('question required', 400);

  const notes = listNotes().filter((n) => n.status === 'ready');
  if (notes.length === 0) {
    return c.json({
      answer: 'No indexed field notes yet. Capture and sync a clip first.',
      citations: [] as AskCitation[],
    });
  }

  const bankChunks: IndexChunk[] = [];
  for (const n of notes) {
    const chunks =
      n.index_chunks && n.index_chunks.length > 0
        ? n.index_chunks
        : buildIndexChunks(n);
    if (!n.index_chunks || n.index_chunks.length === 0) {
      n.index_chunks = chunks;
      saveNote(n);
    }
    bankChunks.push(...chunks);
  }

  const retrieved = retrieveChunks(question, bankChunks, 28);
  const noteMeta = Object.fromEntries(
    notes.map((n) => [
      n.note_id,
      {
        title: n.title,
        demo_label: n.demo_label,
        captured_at: n.sensors.captured_at,
        summary: n.summary,
      },
    ]),
  );

  const prompt = `You are Field Notes, a retrieval assistant for industrial/site operators.
You answer over a BANK of field captures (many jobs/days), not a single video chat.
Use ONLY the retrieved index chunks below.
Be concise and operational — like a foreman briefing.
Synthesize across multiple notes for questions about "this week", supplies, people to follow up with, etc.

Return strict JSON:
{
  "answer": string,
  "bullets": string[],
  "citations": [
    { "note_id": string, "t": number, "kind": "transcript"|"event"|"frame", "quote": string, "frame_hint"?: string }
  ]
}
Prefer concrete timestamps and short quotes from chunks.
ALWAYS include 1–4 citations with short quotes from retrieved chunks — even when the answer is "nothing found", cite the closest related evidence (parts mentioned, tools used, open questions, people named).
Citation kind: transcript cues -> transcript; visual/frame/summary facts -> frame or event.

QUESTION:
${question}

NOTE METADATA:
${JSON.stringify(noteMeta, null, 2)}

RETRIEVED CHUNKS (ranked):
${JSON.stringify(retrieved, null, 2)}`;

  const response = await generateWithRetry({
    model: MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const cost = recordCost('ask', response.usageMetadata);
  const text = response.text ?? '{}';
  try {
    const parsed = JSON.parse(text) as {
      answer: string;
      bullets?: string[];
      citations: AskCitation[];
    };
    const citations = ensureCitations(parsed.citations ?? [], retrieved);
    return c.json({
      answer: parsed.answer ?? text,
      bullets: parsed.bullets ?? [],
      citations: enrichCitations(citations, notes),
      retrieved_count: retrieved.length,
      bank_notes: notes.length,
      cost,
    });
  } catch {
    return c.json({
      answer: text,
      bullets: [],
      citations: enrichCitations(ensureCitations([], retrieved), notes),
      retrieved_count: retrieved.length,
      bank_notes: notes.length,
      cost,
    });
  }
});

async function ingestPipeline(input: {
  note_id: string;
  sensors: CaptureSensors;
  rawPath: string;
  videoPath: string;
  title?: string;
  demo_label?: string;
}): Promise<FieldNote & { cost?: CostReport }> {
  console.log(`[ingest] ${input.note_id} compressing…`);
  let compressed = await compressVideo(input.rawPath, input.videoPath);
  // Never keep a "compress" that made the file larger
  if (compressed.output_bytes > compressed.input_bytes) {
    const { copyFileSync } = await import('node:fs');
    copyFileSync(input.rawPath, input.videoPath);
    compressed = {
      output_path: input.videoPath,
      input_bytes: compressed.input_bytes,
      output_bytes: compressed.input_bytes,
    };
  }
  console.log(
    `[ingest] ${input.note_id} ${compressed.input_bytes} → ${compressed.output_bytes} bytes`,
  );

  if (compressed.output_bytes > MAX_INLINE_BYTES) {
    const harder = join(VIDEOS, `${input.note_id}.hard.mp4`);
    const second = await compressVideo(input.videoPath, harder, {
      crf: '34',
      scale: '640:-2',
      fps: '12',
    });
    renameSync(harder, input.videoPath);
    compressed.output_bytes = second.output_bytes;
  }

  const finalBytes = readFileSync(input.videoPath);
  if (finalBytes.length > MAX_INLINE_BYTES) {
    throw new Error(
      `Compressed video still ${finalBytes.length} bytes (limit ${MAX_INLINE_BYTES}). Record a shorter clip.`,
    );
  }

  const frameDir = join(FRAMES, input.note_id);
  console.log(`[ingest] ${input.note_id} extracting frames every ${FRAME_EVERY_SEC}s…`);
  const frames = await extractSparseFrames({
    videoPath: input.videoPath,
    outDir: frameDir,
    everySeconds: FRAME_EVERY_SEC,
    maxFrames: 24,
  });

  const extractPrompt = `Analyze this field capture for industrial/construction/plant operators.
Build a searchable knowledge index from:
1) spoken audio — as complete a transcript as practical
2) sparse visual facts — equipment IDs, labels, tools, damage, measurements, people, hazards, locations

Return STRICT JSON only:
{
  "summary": string,
  "transcript": [{ "t": number, "text": string }],
  "events": [{ "t": number, "label": string, "detail"?: string, "frame_hint"?: string }]
}
Rules:
- t is seconds from start
- transcript: dense short cues covering narration/dialogue
- events: low-frequency visual index (~every ${FRAME_EVERY_SEC}s or on important moments)
- Prefer recallable job facts over cinematic description
Sensor metadata (context only; do not invent GPS):
${JSON.stringify(input.sensors, null, 2)}
Known frame timestamps extracted: ${frames.map((f) => f.t).join(', ')}`;

  console.log(`[ingest] ${input.note_id} Gemini indexing…`);
  const response = await generateWithRetry({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'video/mp4',
              data: finalBytes.toString('base64'),
            },
          },
          { text: extractPrompt },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });

  const cost = recordCost('ingest', response.usageMetadata, input.note_id);
  const raw = response.text ?? '{}';
  let summary = 'Field capture';
  let transcript: TranscriptCue[] = [];
  let events: FieldEvent[] = [];
  try {
    const parsed = JSON.parse(raw) as {
      summary?: string;
      transcript?: TranscriptCue[];
      events?: FieldEvent[];
    };
    summary = parsed.summary ?? summary;
    transcript = parsed.transcript ?? [];
    events = parsed.events ?? [];
  } catch {
    summary = raw.slice(0, 280);
  }

  // Attach nearest extracted frame image path to events
  events = events.map((ev) => {
    const nearest = frames.reduce<(typeof frames)[0] | null>((best, f) => {
      if (!best) return f;
      return Math.abs(f.t - ev.t) < Math.abs(best.t - ev.t) ? f : best;
    }, null);
    if (nearest && Math.abs(nearest.t - ev.t) <= FRAME_EVERY_SEC + 1) {
      return { ...ev, frame_image: nearest.path };
    }
    return ev;
  });

  // Ensure every extracted frame has at least a visual chunk via synthetic event if missing
  for (const f of frames) {
    const has = events.some((e) => Math.abs(e.t - f.t) <= 2);
    if (!has) {
      events.push({
        t: f.t,
        label: `Visual snapshot @ ${f.t}s`,
        frame_hint: 'Sparse keyframe from capture',
        frame_image: f.path,
      });
    }
  }
  events.sort((a, b) => a.t - b.t);

  const draft: FieldNote = {
    note_id: input.note_id,
    created_at: new Date().toISOString(),
    title: input.title,
    demo_label: input.demo_label,
    sensors: input.sensors,
    summary,
    transcript,
    events,
    video_path: input.videoPath,
    media: {
      original_bytes: compressed.input_bytes,
      compressed_bytes: finalBytes.length,
      frame_count: frames.length,
    },
    status: 'ready',
  };
  draft.index_chunks = buildIndexChunks(draft);

  return { ...draft, cost };
}

async function generateWithRetry(
  params: Parameters<typeof ai.models.generateContent>[0],
  attempts = 5,
) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /429|RESOURCE_EXHAUSTED|Unavailable|timeout/i.test(msg);
      if (!retryable || i === attempts - 1) throw err;
      const waitMs = 2000 * Math.pow(2, i);
      console.warn(`[gemini] retry ${i + 1}/${attempts} in ${waitMs}ms…`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function recordCost(
  op: string,
  usage: Parameters<typeof estimateCost>[1],
  note_id?: string,
): CostReport {
  const base = estimateCost(MODEL, usage);
  return logModelCost(COSTS, { ...base, op, note_id });
}

function serveMp4WithRanges(req: Request, filePath: string): Response {
  const size = statSync(filePath).size;
  const range = req.headers.get('range');
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };

  if (!range) {
    const bytes = readFileSync(filePath);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(size),
      },
    });
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    return new Response('Invalid Range', { status: 416 });
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= size) {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }
  if (end >= size) end = size - 1;
  if (end < start) end = start;

  const chunkSize = end - start + 1;
  const buffer = Buffer.alloc(chunkSize);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buffer, 0, chunkSize, start);
  } finally {
    closeSync(fd);
  }

  return new Response(buffer, {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Length': String(chunkSize),
      'Content-Range': `bytes ${start}-${end}/${size}`,
    },
  });
}

/** Keep Ask UI citation cards filled even when the model answers negatively. */
function ensureCitations(
  citations: AskCitation[],
  retrieved: IndexChunk[],
): AskCitation[] {
  const cleaned = citations.filter(
    (c) => c?.note_id && (c.quote || '').trim().length > 0,
  );
  if (cleaned.length > 0) return cleaned.slice(0, 6);
  return retrieved.slice(0, 3).map((chunk) => ({
    note_id: chunk.note_id,
    t: chunk.t,
    kind: chunk.kind === 'transcript' ? 'transcript' : 'frame',
    quote: chunk.text.slice(0, 220),
    frame_hint: chunk.frame_hint,
  }));
}

function enrichCitations(
  citations: AskCitation[],
  notes: FieldNote[],
): AskCitation[] {
  const byId = new Map(notes.map((n) => [n.note_id, n]));
  return citations.map((c) => {
    const note = byId.get(c.note_id);
    const when = note?.sensors.captured_at || note?.created_at;
    const t = typeof c.t === 'number' ? c.t : Number(c.t) || 0;
    const day_label = when
      ? new Date(when).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
      : undefined;
    const frameDir = note ? join(FRAMES, note.note_id) : null;
    const hasFrames = frameDir && existsSync(frameDir);
    return {
      ...c,
      t,
      day_label,
      source_title:
        note?.title ||
        (note?.summary ? note.summary.slice(0, 72) : undefined) ||
        'Field capture',
      demo_label: note?.demo_label,
      media_url: note ? `/media/${note.note_id}` : undefined,
      frame_image_url: hasFrames ? `/frames/${c.note_id}/${Math.floor(t)}` : undefined,
    };
  });
}

function listNotes(): FieldNote[] {
  return readdirSync(NOTES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(NOTES, f), 'utf8')) as FieldNote)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function saveNote(note: FieldNote) {
  writeFileSync(
    join(NOTES, `${note.note_id}.json`),
    JSON.stringify(note, null, 2),
  );
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Field Notes API on http://0.0.0.0:${port}`);
});
