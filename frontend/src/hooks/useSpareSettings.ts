import { useEffect, useState } from 'react';
import { get } from '../api/client';

export type SpareSettings = {
  notificationDelaySeconds: number;
  byePriorityWindowMinutes: number;
  urgentThresholdHours: number;
  reissueCooldownHours: number;
};

/** Matches the server defaults so copy reads correctly before the settings load. */
export const DEFAULT_SPARE_SETTINGS: SpareSettings = {
  notificationDelaySeconds: 180,
  byePriorityWindowMinutes: 60,
  urgentThresholdHours: 24,
  reissueCooldownHours: 72,
};

let cachedSettings: SpareSettings | null = null;
let inflight: Promise<SpareSettings> | null = null;

export async function fetchSpareSettings(options?: { force?: boolean }): Promise<SpareSettings> {
  if (!options?.force && cachedSettings) return cachedSettings;
  if (!options?.force && inflight) return inflight;
  inflight = get('/public/spare-settings')
    .then((settings) => {
      cachedSettings = settings;
      return settings;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function setCachedSpareSettings(settings: SpareSettings): void {
  cachedSettings = settings;
}

export function useSpareSettings() {
  const [settings, setSettings] = useState<SpareSettings>(cachedSettings ?? DEFAULT_SPARE_SETTINGS);
  const [loading, setLoading] = useState(cachedSettings == null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let canceled = false;
    fetchSpareSettings()
      .then((next) => {
        if (!canceled) setSettings(next);
      })
      .catch(() => {
        if (!canceled) setError(true);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  return { settings, loading, error };
}

export function formatMinutes(minutes: number): string {
  if (minutes === 0) return '0 minutes';
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function formatHours(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function formatSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return formatMinutes(seconds / 60);
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}
