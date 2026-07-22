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
}): Promise<FieldNote> {
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
    throw new Error(text || `Ingest failed (${res.status})`);
  }

  const accepted = (await res.json()) as FieldNote;
  // Tunnel proxies often die during long Gemini work — poll until ready/error.
  return waitForNote(accepted.note_id, accepted);
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
  opts?: { timeout_ms?: number; interval_ms?: number },
): Promise<FieldNote> {
  const timeout_ms = opts?.timeout_ms ?? 180_000;
  const interval_ms = opts?.interval_ms ?? 2500;
  const started = Date.now();
  let latest = seed;

  while (Date.now() - started < timeout_ms) {
    if (latest.status === 'ready' || latest.status === 'error') return latest;
    await new Promise((r) => setTimeout(r, interval_ms));
    try {
      const next = await getServerNote(note_id);
      if (next) latest = next;
    } catch {
      // transient tunnel blip — keep waiting
    }
  }

  if (latest.status === 'syncing') {
    return {
      ...latest,
      status: 'syncing',
      error_message:
        'Still indexing on server — open Library and tap Sync in a moment.',
    };
  }
  return latest;
}

export async function askFieldNotes(question: string): Promise<AskResponse> {
  const res = await fetch(`${API_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Ask failed (${res.status})`);
  }

  return (await res.json()) as AskResponse;
}

export async function listServerNotes(): Promise<FieldNote[]> {
  const res = await fetch(`${API_URL}/notes`);
  if (!res.ok) throw new Error('Failed to list notes');
  const data = (await res.json()) as { notes: FieldNote[] };
  return data.notes;
}
