import { StyleSheet, Text, View } from 'react-native';
import type { FieldNote } from '../types/notes';

type Props = {
  onCaptured: (note: FieldNote) => void;
};

/** Web fallback — capture is phone-only; demo Q&A uses the seeded library. */
export function CaptureScreen(_props: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>CAPTURE</Text>
      <Text style={styles.title}>Phone only</Text>
      <Text style={styles.body}>
        Browser demo uses the existing field library. Open Home and ask the
        chips, or browse Library — no recording needed on laptop.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0e1114',
    paddingTop: 56,
    paddingHorizontal: 20,
  },
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
  body: { color: '#8f887c', marginTop: 12, lineHeight: 22 },
});
