import * as Location from 'expo-location';
import * as Device from 'expo-device';
import type { CaptureSensors } from '../types/notes';

export async function collectSensors(): Promise<CaptureSensors> {
  let geo: CaptureSensors['geo'] = null;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status === 'granted') {
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      geo = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        altitude: pos.coords.altitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
      };
    } catch {
      geo = null;
    }
  }

  return {
    captured_at: new Date().toISOString(),
    timezone_offset_minutes: new Date().getTimezoneOffset(),
    geo,
    device: {
      brand: Device.brand,
      model_name: Device.modelName,
      os_name: Device.osName,
      os_version: Device.osVersion,
    },
  };
}
