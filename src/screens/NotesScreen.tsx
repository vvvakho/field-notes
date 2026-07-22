import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { FieldNote } from '../types/notes';
import { ingestCapture, listServerNotes, pingServer } from '../lib/api';
import { API_URL } from '../lib/config';
import { replaceNotes, upsertNote } from '../lib/noteStore';

type Props = {
  notes: FieldNote[];
  onChange: (note: FieldNote) => void;
  onReplace: (notes: FieldNote[]) => void;
};

export function NotesScreen({ notes, onChange, onReplace }: Props) {
  const [syncing, setSyncing] = useState(false);

  async function syncFromServer() {
    setSyncing(true);
    try {
      const online = await pingServer();
      if (!online) return;
      const remote = await listServerNotes();
      const localById = new Map(notes.map((n) => [n.note_id, n]));
      const merged: FieldNote[] = remote.map((r) => ({
        ...r,
        local_video_uri: localById.get(r.note_id)?.local_video_uri,
        status: 'ready' as const,
      }));
      // Keep unsynced locals
      for (const n of notes) {
        if (!merged.find((m) => m.note_id === n.note_id)) merged.unshift(n);
      }
      await replaceNotes(merged);
      onReplace(merged);
    } finally {
      setSyncing(false);
    }
  }

  async function retry(note: FieldNote) {
    if (!note.local_video_uri) return;
    const online = await pingServer();
    if (!online) return;

    const pending: FieldNote = {
      ...note,
      status: 'syncing',
      error_message: undefined,
    };
    await upsertNote(pending);
    onChange(pending);

    try {
      const ready = await ingestCapture({
        note_id: note.note_id,
        video_uri: note.local_video_uri,
        sensors: note.sensors,
      });
      const merged: FieldNote = {
        ...ready,
        local_video_uri: note.local_video_uri,
        status: 'ready',
      };
      await upsertNote(merged);
      onChange(merged);
    } catch (err) {
      const failed: FieldNote = {
        ...note,
        status: 'error',
        error_message: err instanceof Error ? err.message : 'Sync failed',
      };
      await upsertNote(failed);
      onChange(failed);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>LIBRARY</Text>
          <Text style={styles.title}>Captures</Text>
        </View>
        <Pressable style={styles.syncBtn} onPress={syncFromServer}>
          {syncing ? (
            <ActivityIndicator color="#8fdb9a" />
          ) : (
            <Text style={styles.syncText}>Sync</Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.sub}>
        Live phone captures plus job examples. Judges: the electrical panel clip
        is an example video from the job.
      </Text>

      <FlatList
        data={notes}
        keyExtractor={(n) => n.note_id}
        contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No captures yet. Record one, or tap Sync to pull the demo job video.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.status}>{item.status.toUpperCase()}</Text>
              <Text style={styles.time}>
                {new Date(
                  item.sensors.captured_at || item.created_at,
                ).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
            </View>

            {item.demo_label ? (
              <Text style={styles.demoPill}>{item.demo_label}</Text>
            ) : null}

            <Text style={styles.cardTitle}>
              {item.title || 'Field capture'}
            </Text>
            <Text style={styles.summary} numberOfLines={3}>
              {item.summary}
            </Text>

            <VideoThumb note={item} />

            <Text style={styles.meta}>
              {item.events.length} events · {item.transcript.length} transcript
              cues
              {item.index_chunks?.length
                ? ` · ${item.index_chunks.length} index chunks`
                : ''}
              {item.media?.frame_count
                ? ` · ${item.media.frame_count} frames`
                : ''}
            </Text>
            {item.media?.compressed_bytes ? (
              <Text style={styles.meta}>
                media {(item.media.compressed_bytes / (1024 * 1024)).toFixed(1)}
                MB
                {item.media.original_bytes
                  ? ` (from ${(item.media.original_bytes / (1024 * 1024)).toFixed(1)}MB)`
                  : ''}
              </Text>
            ) : null}

            {(item.status === 'local' || item.status === 'error') &&
            item.local_video_uri ? (
              <Pressable style={styles.retry} onPress={() => retry(item)}>
                <Text style={styles.retryText}>Sync now</Text>
              </Pressable>
            ) : null}
            {item.error_message ? (
              <Text style={styles.error}>{item.error_message}</Text>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

function VideoThumb({ note }: { note: FieldNote }) {
  const uri =
    note.local_video_uri ||
    (note.status === 'ready' ? `${API_URL}/media/${note.note_id}` : null);
  if (!uri) return null;
  return <LibraryVideo uri={uri} />;
}

function LibraryVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={styles.thumb}
      nativeControls
      contentFit="cover"
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0e1114',
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  kicker: {
    color: '#c4a35a',
    letterSpacing: 2,
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: '#f3efe6',
    fontSize: 28,
    fontWeight: '700',
    marginTop: 8,
  },
  syncBtn: {
    backgroundColor: '#1a2a20',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 64,
    alignItems: 'center',
  },
  syncText: { color: '#8fdb9a', fontWeight: '700' },
  sub: { color: '#8f887c', marginTop: 10, marginBottom: 16, lineHeight: 20 },
  empty: { color: '#8f887c', marginTop: 24, lineHeight: 22 },
  card: {
    backgroundColor: '#14181c',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a3036',
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  status: { color: '#c4a35a', fontWeight: '700', fontSize: 12 },
  time: { color: '#8f887c', fontSize: 12 },
  demoPill: {
    alignSelf: 'flex-start',
    color: '#8fdb9a',
    backgroundColor: '#1a2a20',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  cardTitle: { color: '#f3efe6', fontSize: 17, fontWeight: '700', marginTop: 2 },
  summary: { color: '#d9d3c7', fontSize: 14, lineHeight: 20 },
  thumb: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    backgroundColor: '#0a0c0e',
    marginTop: 6,
  },
  meta: { color: '#8f887c', marginTop: 4, fontSize: 12 },
  retry: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#243028',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryText: { color: '#8fdb9a', fontWeight: '700' },
  error: { color: '#e35d4b', marginTop: 6, fontSize: 12 },
});
