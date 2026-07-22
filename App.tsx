import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { AskScreen } from './src/screens/AskScreen';
import { NotesScreen } from './src/screens/NotesScreen';
import { listServerNotes, pingServer } from './src/lib/api';
import { loadNotes, replaceNotes, upsertNote } from './src/lib/noteStore';
import type { FieldNote } from './src/types/notes';

type Tab = 'home' | 'capture' | 'library';

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [notes, setNotes] = useState<FieldNote[]>([]);

  const hydrate = useCallback(async () => {
    const local = await loadNotes();
    setNotes(local);
    const online = await pingServer();
    if (!online) return;
    try {
      const remote = await listServerNotes();
      if (remote.length === 0) return;
      const localById = new Map(local.map((n) => [n.note_id, n]));
      const merged: FieldNote[] = remote.map((r) => ({
        ...r,
        local_video_uri: localById.get(r.note_id)?.local_video_uri,
        status: 'ready' as const,
      }));
      for (const n of local) {
        if (!merged.find((m) => m.note_id === n.note_id)) merged.unshift(n);
      }
      await replaceNotes(merged);
      setNotes(merged);
    } catch {
      // keep local
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const onNote = useCallback(async (note: FieldNote) => {
    const next = await upsertNote(note);
    setNotes([...next]);
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.body}>
        {tab === 'home' ? <AskScreen notes={notes} /> : null}
        {tab === 'capture' ? <CaptureScreen onCaptured={onNote} /> : null}
        {tab === 'library' ? (
          <NotesScreen
            notes={notes}
            onChange={onNote}
            onReplace={(next) => setNotes([...next])}
          />
        ) : null}
      </View>
      <View style={styles.tabs}>
        {(
          [
            ['home', 'Home'],
            ['capture', 'Capture'],
            ['library', 'Library'],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            style={[styles.tab, tab === id && styles.tabActive]}
            onPress={() => setTab(id)}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1114' },
  body: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#242a30',
    backgroundColor: '#0e1114',
    paddingBottom: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  tabActive: {
    borderTopWidth: 2,
    borderTopColor: '#c4a35a',
  },
  tabText: { color: '#8f887c', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#f3efe6' },
});
