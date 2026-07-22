import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { askFieldNotes } from '../lib/api';
import { API_URL } from '../lib/config';
import type { AskCitation, AskResponse, FieldNote } from '../types/notes';
import { DEMO_QUESTIONS } from '../types/notes';

type Props = {
  notes: FieldNote[];
};

export function AskScreen({ notes }: Props) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readyCount = useMemo(
    () => notes.filter((n) => n.status === 'ready').length,
    [notes],
  );

  async function runAsk(qRaw?: string) {
    const q = (qRaw ?? question).trim();
    if (!q || loading) return;
    setQuestion(q);
    setLoading(true);
    setError(null);
    try {
      const res = await askFieldNotes(q);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ask failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.kicker}>FIELD NOTES</Text>
      <Text style={styles.title}>Ask your field</Text>
      <Text style={styles.meta}>
        {readyCount} capture{readyCount === 1 ? '' : 's'} indexed · walk away
        with answers, not footage homework
      </Text>

      <View style={styles.chips}>
        {DEMO_QUESTIONS.map((q) => (
          <Pressable
            key={q}
            style={[styles.chip, question === q && styles.chipActive]}
            onPress={() => runAsk(q)}
          >
            <Text
              style={[styles.chipText, question === q && styles.chipTextActive]}
            >
              {q}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.box}>
        <TextInput
          style={styles.input}
          placeholder="Ask anything about the job…"
          placeholderTextColor="#7a756c"
          value={question}
          onChangeText={setQuestion}
          multiline
        />
        <Pressable
          style={styles.askBtn}
          onPress={() => runAsk()}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#16120a" />
          ) : (
            <Text style={styles.askBtnText}>Ask</Text>
          )}
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <View style={styles.answerCard}>
          <Text style={styles.answerLabel}>ANSWER</Text>
          <Text style={styles.answer}>{result.answer}</Text>

          {(result.bullets?.length ?? 0) > 0 ? (
            <View style={styles.bullets}>
              {result.bullets!.map((b, i) => (
                <View key={`${i}-${b.slice(0, 12)}`} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.citeLabel}>SOURCES</Text>
          {result.citations.map((item, i) => (
            <CitationCard
              key={`${item.note_id}-${item.t}-${i}`}
              citation={item}
            />
          ))}
        </View>
      ) : (
        <View style={styles.hintCard}>
          <Text style={styles.hintTitle}>Demo flow</Text>
          <Text style={styles.hintText}>
            1. Capture a clip while narrating{'\n'}
            2. Library fills with indexed video{'\n'}
            3. Come home and ask the chips above
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function CitationCard({ citation }: { citation: AskCitation }) {
  const videoRef = useRef<Video>(null);
  const [playing, setPlaying] = useState(false);
  const mm = Math.floor(citation.t / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(citation.t % 60)
    .toString()
    .padStart(2, '0');
  const mediaUri = citation.media_url
    ? citation.media_url.startsWith('http')
      ? citation.media_url
      : `${API_URL}${citation.media_url}`
    : null;

  async function togglePlay() {
    if (!mediaUri || !videoRef.current) return;
    if (!playing) {
      await videoRef.current.setPositionAsync(Math.max(0, citation.t - 0.5) * 1000);
      await videoRef.current.playAsync();
      setPlaying(true);
    } else {
      await videoRef.current.pauseAsync();
      setPlaying(false);
    }
  }

  return (
    <View style={styles.cite}>
      <View style={styles.citeHeader}>
        <Text style={styles.citeDay}>{citation.day_label ?? 'Field day'}</Text>
        {citation.demo_label ? (
          <Text style={styles.demoPill}>{citation.demo_label}</Text>
        ) : null}
      </View>
      <Text style={styles.citeTitle}>
        {citation.source_title ?? 'Field capture'}
      </Text>
      <Text style={styles.citeTime}>
        {mm}:{ss} · {citation.kind}
      </Text>
      <Text style={styles.citeQuote}>“{citation.quote}”</Text>
      {citation.frame_hint ? (
        <Text style={styles.frameHint}>Visual: {citation.frame_hint}</Text>
      ) : null}

      {citation.frame_image_url ? (
        <Image
          source={{
            uri: citation.frame_image_url.startsWith('http')
              ? citation.frame_image_url
              : `${API_URL}${citation.frame_image_url}`,
          }}
          style={styles.frameImage}
        />
      ) : null}

      {mediaUri ? (
        <View style={styles.snippet}>
          <Video
            ref={videoRef}
            style={styles.video}
            source={{ uri: mediaUri }}
            useNativeControls={false}
            resizeMode={ResizeMode.COVER}
            isLooping={false}
            onPlaybackStatusUpdate={(s) => {
              if (!s.isLoaded) return;
              if (s.didJustFinish) setPlaying(false);
            }}
          />
          <Pressable style={styles.playBtn} onPress={togglePlay}>
            <Text style={styles.playBtnText}>
              {playing ? 'Pause snippet' : `Play from ${mm}:${ss}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1114' },
  content: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 40 },
  kicker: {
    color: '#c4a35a',
    letterSpacing: 2,
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: '#f3efe6',
    fontSize: 30,
    fontWeight: '700',
    marginTop: 8,
  },
  meta: { color: '#8f887c', marginTop: 8, marginBottom: 16, lineHeight: 20 },
  chips: { gap: 8, marginBottom: 14 },
  chip: {
    backgroundColor: '#171b1f',
    borderWidth: 1,
    borderColor: '#2a3036',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chipActive: { borderColor: '#c4a35a', backgroundColor: '#1c1912' },
  chipText: { color: '#d9d3c7', fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#f3efe6' },
  box: {
    backgroundColor: '#171b1f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a3036',
    padding: 12,
    gap: 10,
  },
  input: {
    minHeight: 64,
    color: '#f3efe6',
    fontSize: 16,
    textAlignVertical: 'top',
  },
  askBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#c4a35a',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 84,
    alignItems: 'center',
  },
  askBtnText: { color: '#16120a', fontWeight: '700' },
  error: { color: '#e35d4b', marginTop: 12 },
  answerCard: {
    marginTop: 18,
    backgroundColor: '#14181c',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a3036',
    gap: 8,
  },
  answerLabel: {
    color: '#c4a35a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  answer: { color: '#f3efe6', fontSize: 17, lineHeight: 26, fontWeight: '600' },
  bullets: { marginTop: 8, gap: 6 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bulletDot: { color: '#c4a35a', fontSize: 16, lineHeight: 22 },
  bulletText: { color: '#d9d3c7', flex: 1, lineHeight: 22 },
  citeLabel: {
    color: '#8f887c',
    marginTop: 14,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  cite: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a3036',
    gap: 4,
  },
  citeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  citeDay: { color: '#c4a35a', fontSize: 12, fontWeight: '700' },
  demoPill: {
    color: '#8fdb9a',
    backgroundColor: '#1a2a20',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: '700',
  },
  citeTitle: { color: '#f3efe6', fontSize: 15, fontWeight: '700' },
  citeTime: { color: '#8f887c', fontSize: 12, marginTop: 2 },
  citeQuote: { color: '#d9d3c7', marginTop: 6, lineHeight: 21, fontStyle: 'italic' },
  frameHint: { color: '#8f887c', marginTop: 4, fontSize: 12 },
  frameImage: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    backgroundColor: '#0a0c0e',
    marginTop: 8,
  },
  snippet: { marginTop: 10, gap: 8 },
  video: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    backgroundColor: '#0a0c0e',
  },
  playBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#243028',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  playBtnText: { color: '#8fdb9a', fontWeight: '700', fontSize: 12 },
  hintCard: {
    marginTop: 18,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a3036',
    backgroundColor: '#12161a',
  },
  hintTitle: { color: '#c4a35a', fontWeight: '700', marginBottom: 8 },
  hintText: { color: '#a8a297', lineHeight: 22 },
});
