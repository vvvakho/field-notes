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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Ingest failed (${res.status})`);
  }

  return (await res.json()) as FieldNote;
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
