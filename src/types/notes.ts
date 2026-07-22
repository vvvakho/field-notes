export type GeoPoint = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
};

export type CaptureSensors = {
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

export type TranscriptCue = {
  t: number;
  text: string;
};

export type FieldEvent = {
  t: number;
  label: string;
  detail?: string;
  frame_hint?: string;
};

export type FieldNote = {
  note_id: string;
  created_at: string;
  title?: string;
  demo_label?: string;
  sensors: CaptureSensors;
  summary: string;
  transcript: TranscriptCue[];
  events: FieldEvent[];
  index_chunks?: {
    chunk_id: string;
    note_id: string;
    t: number;
    kind: 'transcript' | 'frame' | 'summary';
    text: string;
    frame_hint?: string;
  }[];
  media?: {
    original_bytes?: number;
    compressed_bytes?: number;
    frame_count?: number;
  };
  video_path?: string;
  status: 'local' | 'syncing' | 'ready' | 'error';
  error_message?: string;
  local_video_uri?: string;
  progress?: {
    stage: string;
    message: string;
    percent: number;
    updated_at: string;
  };
};

export type AskCitation = {
  note_id: string;
  t: number;
  kind: 'transcript' | 'event' | 'frame';
  quote: string;
  frame_hint?: string;
  /** Enriched by API for UI */
  day_label?: string;
  source_title?: string;
  demo_label?: string;
  media_url?: string;
  frame_image_url?: string;
};

export type AskResponse = {
  answer: string;
  bullets?: string[];
  citations: AskCitation[];
  cost?: unknown;
};

export const DEMO_QUESTIONS = [
  'What work did we do this week?',
  'What supplies do I need to buy?',
  'Who do I need to circle back to?',
] as const;
