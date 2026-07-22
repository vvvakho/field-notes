export type IndexChunk = {
  chunk_id: string;
  note_id: string;
  t: number;
  kind: 'transcript' | 'frame' | 'summary';
  text: string;
  frame_hint?: string;
};

export function buildIndexChunks(note: {
  note_id: string;
  summary: string;
  transcript: { t: number; text: string }[];
  events: { t: number; label: string; detail?: string; frame_hint?: string }[];
}): IndexChunk[] {
  const chunks: IndexChunk[] = [];

  chunks.push({
    chunk_id: `${note.note_id}:summary`,
    note_id: note.note_id,
    t: 0,
    kind: 'summary',
    text: note.summary,
  });

  for (const cue of note.transcript) {
    const text = (cue.text || '').trim();
    if (!text) continue;
    chunks.push({
      chunk_id: `${note.note_id}:tr:${cue.t}`,
      note_id: note.note_id,
      t: cue.t,
      kind: 'transcript',
      text,
    });
  }

  // Sparse visual index: event/frame captions (low frequency vs every frame)
  for (const ev of note.events) {
    const text = [ev.label, ev.detail, ev.frame_hint].filter(Boolean).join(' — ');
    if (!text.trim()) continue;
    chunks.push({
      chunk_id: `${note.note_id}:fr:${ev.t}:${ev.label.slice(0, 24)}`,
      note_id: note.note_id,
      t: ev.t,
      kind: 'frame',
      text,
      frame_hint: ev.frame_hint,
    });
  }

  return chunks;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

const QUERY_EXPANSIONS: Record<string, string[]> = {
  supplies: ['parts', 'filter', 'oil', 'buy', 'order', 'purchase', 'material', 'need'],
  buy: ['purchase', 'order', 'parts', 'filter', 'oil', 'supplies'],
  need: ['parts', 'order', 'buy', 'supplies', 'missing'],
  who: ['engineer', 'dom', 'call', 'quote', 'follow', 'contact'],
  circle: ['follow', 'call', 'quote', 'engineer', 'dom'],
  week: ['job', 'panel', 'oil', 'upgrade', 'assessment', 'capture'],
  work: ['panel', 'oil', 'upgrade', 'assessment', 'replace', 'inspect'],
};

/** Lightweight bank retrieval for hackathon — swap for embeddings later. */
export function retrieveChunks(
  question: string,
  chunks: IndexChunk[],
  limit = 24,
): IndexChunk[] {
  const base = tokenize(question);
  const expanded = new Set(base);
  for (const t of base) {
    for (const extra of QUERY_EXPANSIONS[t] ?? []) expanded.add(extra);
  }
  const qTokens = [...expanded];
  if (qTokens.length === 0) return chunks.slice(0, limit);

  const scored = chunks.map((chunk) => {
    const text = chunk.text.toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      if (text.includes(t)) score += 1;
    }
    // Prefer concrete transcript/frame over summary unless query is broad
    if (chunk.kind === 'summary') score *= 0.85;
    if (chunk.kind === 'frame') score *= 1.1;
    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score || a.chunk.t - b.chunk.t);
  const top = scored.filter((s) => s.score > 0).slice(0, limit);
  if (top.length >= Math.min(8, limit)) return top.map((s) => s.chunk);

  // Fallback: mix of recent-ish chunks from each note so bank still answers
  return scored.slice(0, limit).map((s) => s.chunk);
}
