import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { FieldNote } from '../types/notes';

type Props = {
  notes: FieldNote[];
};

/**
 * Hackathon spatial preview — NOT photogrammetry.
 * Plots GPS-relative capture breadcrumbs so demos can gesture at "scene memory".
 * True 3D reconstruction from phone video is a later research/product track.
 */
export function SpatialScreen({ notes }: Props) {
  const points = useMemo(() => {
    return notes
      .filter((n) => n.sensors.geo)
      .map((n) => ({
        id: n.note_id,
        lat: n.sensors.geo!.latitude,
        lng: n.sensors.geo!.longitude,
        summary: n.summary,
        status: n.status,
      }));
  }, [notes]);

  const layout = useMemo(() => {
    if (points.length === 0) return [];
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const dLat = Math.max(maxLat - minLat, 0.00001);
    const dLng = Math.max(maxLng - minLng, 0.00001);

    return points.map((p, i) => ({
      ...p,
      x: ((p.lng - minLng) / dLng) * 80 + 10,
      y: (1 - (p.lat - minLat) / dLat) * 70 + 15,
      index: i + 1,
    }));
  }, [points]);

  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>SPATIAL PREVIEW</Text>
      <Text style={styles.title}>Site memory map</Text>
      <Text style={styles.sub}>
        Simple GPS breadcrumb scene from captures. Full mesh/NeRF rebuild is
        out of MVP scope — this proves the sensor+visual memory idea.
      </Text>

      <View style={styles.stage}>
        {layout.length === 0 ? (
          <Text style={styles.empty}>Capture outdoors with GPS to plot.</Text>
        ) : (
          layout.map((p) => (
            <View
              key={p.id}
              style={[
                styles.pin,
                {
                  left: `${p.x}%` as unknown as number,
                  top: `${p.y}%` as unknown as number,
                },
              ]}
            >
              <View style={styles.dot}>
                <Text style={styles.dotText}>{p.index}</Text>
              </View>
              <Text numberOfLines={2} style={styles.pinLabel}>
                {p.summary}
              </Text>
            </View>
          ))
        )}
      </View>
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
  sub: { color: '#8f887c', marginTop: 8, lineHeight: 20, marginBottom: 16 },
  stage: {
    flex: 1,
    backgroundColor: '#12171b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a3036',
    marginBottom: 24,
    overflow: 'hidden',
  },
  empty: { color: '#8f887c', padding: 20 },
  pin: {
    position: 'absolute',
    width: 120,
    marginLeft: -12,
    marginTop: -12,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#c4a35a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { color: '#16120a', fontWeight: '800', fontSize: 12 },
  pinLabel: { color: '#d9d3c7', fontSize: 11, marginTop: 4, width: 110 },
});
