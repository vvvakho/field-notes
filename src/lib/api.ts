import type { AskResponse, CaptureSensors, FieldNote } from '../types/notes';
import { API_URL } from './config';

export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ingestCapture(params: {
  note_id: string;
  video_uri: string;
  sensors: CaptureSensors;
  onProgress?: (note: FieldNote) => void;
}): Promise<FieldNote> {
  console.log(`[sync] uploading ${params.note_id} → ${API_URL}/ingest`);
  params.onProgress?.({
    note_id: params.note_id,
    created_at: new Date().toISOString(),
    sensors: params.sensors,
    summary: 'Uploading video to server…',
    transcript: [],
    events: [],
    status: 'syncing',
    progress: {
      stage: 'upload',
      message: 'Uploading video to server…',
      percent: 5,
      updated_at: new Date().toISOString(),
    },
  });

  const form = new FormData();
  form.append('note_id', params.note_id);
  form.append('sensors', JSON.stringify(params.sensors));
  form.append('video', {
    uri: params.video_uri,
    name: `${params.note_id}.mp4`,
    type: 'video/mp4',
  } as unknown as Blob);

  const res = await fetch(`${API_URL}/ingest`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok && res.status !== 202) {
    const text = await res.text();
    console.log(`[sync] upload failed ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(text || `Ingest failed (${res.status})`);
  }

  const accepted = (await res.json()) as FieldNote;
  console.log(
    `[sync] upload accepted ${accepted.note_id} status=${accepted.status} · ${accepted.progress?.message ?? accepted.summary}`,
  );
  params.onProgress?.(accepted);

  // Tunnel proxies often die during long Gemini work — poll until ready/error.
  return waitForNote(accepted.note_id, accepted, {
    onProgress: params.onProgress,
  });
}

export async function getServerNote(note_id: string): Promise<FieldNote | null> {
  const res = await fetch(`${API_URL}/notes/${note_id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch note (${res.status})`);
  return (await res.json()) as FieldNote;
}

async function waitForNote(
  note_id: string,
  seed: FieldNote,
  opts?: {
    timeout_ms?: number;
    interval_ms?: number;
    onProgress?: (note: FieldNote) => void;
  },
): Promise<FieldNote> {
  const timeout_ms = opts?.timeout_ms ?? 180_000;
  const interval_ms = opts?.interval_ms ?? 1500;
  const started = Date.now();
  let latest = seed;
  let lastMsg = '';

  while (Date.now() - started < timeout_ms) {
    if (latest.status === 'ready' || latest.status === 'error') {
      console.log(
        `[sync] ${note_id} ${latest.status.toUpperCase()} · ${latest.progress?.message ?? latest.summary}`,
      );
      return latest;
    }
    await new Promise((r) => setTimeout(r, interval_ms));
    try {
      const next = await getServerNote(note_id);
      if (next) {
        latest = next;
        const msg =
          next.progress?.message ||
          next.summary ||
          `Syncing… (${next.progress?.percent ?? '?'}%)`;
        if (msg !== lastMsg) {
          lastMsg = msg;
          console.log(
            `[sync] ${note_id} ${next.progress?.percent ?? '?'}% · ${msg}`,
          );
          opts?.onProgress?.(next);
        }
      }
    } catch (err) {
      console.log(
        `[sync] ${note_id} poll blip:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (latest.status === 'syncing') {
    console.log(`[sync] ${note_id} still indexing after timeout — check Library Sync`);
    return {
      ...latest,
      status: 'syncing',
      error_message:
        'Still indexing on server — open Library and tap Sync in a moment.',
      progress: {
        stage: 'waiting',
        message:
          'Still indexing on server — open Library and tap Sync in a moment.',
        percent: latest.progress?.percent ?? 90,
        updated_at: new Date().toISOString(),
      },
    };
  }
  return latest;
}

async function readJson<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (
    !res.ok ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    /Cloudflare Tunnel error/i.test(trimmed)
  ) {
    throw new Error(
      `${label} failed (${res.status}). Tunnel/API unreachable — restart cloudflared and reload Expo.`,
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${label} returned non-JSON (${res.status})`);
  }
}

export async function askFieldNotes(question: string): Promise<AskResponse> {
  const res = await fetch(`${API_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  return readJson<AskResponse>(res, 'Ask');
}

export async function listServerNotes(): Promise<FieldNote[]> {
  const res = await fetch(`${API_URL}/notes`);
  const data = await readJson<{ notes: FieldNote[] }>(res, 'List notes');
  return data.notes;
}
