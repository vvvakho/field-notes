import { Platform } from 'react-native';

/**
 * Expo Go on a physical device cannot reach localhost.
 * Set EXPO_PUBLIC_API_URL to your machine's LAN IP, e.g. http://192.168.1.12:8787
 */
const fallback =
  Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://127.0.0.1:8787';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? fallback).replace(
  /\/$/,
  '',
);
