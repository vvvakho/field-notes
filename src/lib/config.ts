import { Platform } from 'react-native';

/**
 * Phone / Expo Go: use EXPO_PUBLIC_API_URL (usually a Cloudflare quick tunnel).
 * Web on this Mac: always hit local API — no tunnel required for laptop demos.
 */
const fallback =
  Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://127.0.0.1:8787';

export const API_URL = (
  Platform.OS === 'web'
    ? 'http://127.0.0.1:8787'
    : (process.env.EXPO_PUBLIC_API_URL ?? fallback)
).replace(/\/$/, '');
