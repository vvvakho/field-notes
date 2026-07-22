import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FieldNote } from '../types/notes';

const KEY = 'field_notes_v1';

export async function loadNotes(): Promise<FieldNote[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as FieldNote[];
  } catch {
    return [];
  }
}

export async function saveNotes(notes: FieldNote[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(notes));
}

export async function upsertNote(note: FieldNote): Promise<FieldNote[]> {
  const notes = await loadNotes();
  const idx = notes.findIndex((n) => n.note_id === note.note_id);
  if (idx >= 0) notes[idx] = note;
  else notes.unshift(note);
  await saveNotes(notes);
  return notes;
}

export async function replaceNotes(notes: FieldNote[]): Promise<void> {
  await saveNotes(notes);
}
