import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
import { collectSensors } from '../lib/sensors';
import { ingestCapture, pingServer } from '../lib/api';
import { upsertNote } from '../lib/noteStore';
import { newNoteId } from '../lib/id';
import type { FieldNote } from '../types/notes';

type Props = {
  onCaptured: (note: FieldNote) => void;
};

export function CaptureScreen({ onCaptured }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready to capture');
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    pingServer().then(setOnline);
    const id = setInterval(() => {
      pingServer().then(setOnline);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  if (!camPerm || !micPerm) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#c4a35a" />
      </View>
    );
  }

  if (!camPerm.granted || !micPerm.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera + mic needed</Text>
        <Text style={styles.sub}>
          Field Notes captures video, voice, and phone sensors while you walk
          the site.
        </Text>
        <Pressable
          style={styles.primaryBtn}
          onPress={async () => {
            await requestCamPerm();
            await requestMicPerm();
          }}
        >
          <Text style={styles.primaryBtnText}>Grant permissions</Text>
        </Pressable>
      </View>
    );
  }

  async function toggleRecord() {
    if (busy) return;

    if (!recording) {
      setStatus('Recording… narrate what you see');
      setRecording(true);
      try {
        const video = await cameraRef.current?.recordAsync({
          maxDuration: 60,
        });
        if (!video?.uri) {
          setStatus('No video captured');
          setRecording(false);
          return;
        }
        await finalize(video.uri);
      } catch (err) {
        setRecording(false);
        setStatus(err instanceof Error ? err.message : 'Recording failed');
      }
      return;
    }

    cameraRef.current?.stopRecording();
    setRecording(false);
    setStatus('Stopping…');
  }

  async function finalize(videoUri: string) {
    setBusy(true);
    setStatus('Collecting sensors…');
    const note_id = newNoteId();
    const sensors = await collectSensors();

    const localNote: FieldNote = {
      note_id,
      created_at: new Date().toISOString(),
      sensors,
      summary: 'Local capture pending sync',
      transcript: [],
      events: [],
      status: 'local',
      local_video_uri: videoUri,
    };
    await upsertNote(localNote);
    onCaptured(localNote);

    const reachable = await pingServer();
    setOnline(reachable);

    if (!reachable) {
      setStatus('Saved offline — will sync when server is reachable');
      setBusy(false);
      return;
    }

    try {
      setStatus('Syncing + Gemini ingest…');
      const pending: FieldNote = { ...localNote, status: 'syncing' };
      await upsertNote(pending);
      onCaptured(pending);

      const ready = await ingestCapture({
        note_id,
        video_uri: videoUri,
        sensors,
      });
      const merged: FieldNote = {
        ...ready,
        local_video_uri: videoUri,
        status: 'ready',
      };
      await upsertNote(merged);
      onCaptured(merged);
      setStatus('Ready — ask about this capture');
    } catch (err) {
      const failed: FieldNote = {
        ...localNote,
        status: 'error',
        error_message: err instanceof Error ? err.message : 'Sync failed',
      };
      await upsertNote(failed);
      onCaptured(failed);
      setStatus(failed.error_message ?? 'Sync failed');
    } finally {
      setBusy(false);
      setRecording(false);
    }
  }

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="video"
        videoQuality="480p"
      />
      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <Text style={styles.brand}>FIELD NOTES</Text>
          <Text
            style={[
              styles.pill,
              online ? styles.pillOn : styles.pillOff,
            ]}
          >
            {online === null ? '…' : online ? 'SERVER' : 'OFFLINE'}
          </Text>
        </View>
        <Text style={styles.status}>{status}</Text>
        <Pressable
          style={[
            styles.shutter,
            recording && styles.shutterHot,
            busy && styles.shutterBusy,
          ]}
          onPress={toggleRecord}
          disabled={busy}
        >
          <View
            style={[styles.shutterInner, recording && styles.shutterInnerHot]}
          />
        </Pressable>
        <Text style={styles.hint}>
          {recording
            ? 'Keep talking — describe units, hazards, parts'
            : 'Tap to capture · walk the site · narrate out loud'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1114' },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: 36,
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: '#f3efe6',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
  pill: {
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  pillOn: { backgroundColor: '#1f3d2a', color: '#8fdb9a' },
  pillOff: { backgroundColor: '#3a2418', color: '#f0b089' },
  status: {
    color: '#f3efe6',
    textAlign: 'center',
    fontSize: 15,
    backgroundColor: 'rgba(8,10,12,0.45)',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  shutter: {
    alignSelf: 'center',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#f3efe6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterHot: { borderColor: '#e35d4b' },
  shutterBusy: { opacity: 0.5 },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#e35d4b',
  },
  shutterInnerHot: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  hint: {
    color: '#c8c2b6',
    textAlign: 'center',
    fontSize: 13,
  },
  center: {
    flex: 1,
    backgroundColor: '#0e1114',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 14,
  },
  title: { color: '#f3efe6', fontSize: 22, fontWeight: '700' },
  sub: { color: '#a8a297', textAlign: 'center', lineHeight: 22 },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: '#c4a35a',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#16120a', fontWeight: '700' },
});
