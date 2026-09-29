import axios from 'axios';
import { getApiErrorMessage } from './api';

export function filenameFromDisposition(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]);
  const match = /filename="?([^"]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Blob requests return JSON error envelopes as Blobs, so read them before falling back. */
export async function messageFromBlobError(error: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await error.response.data.text()) as { error?: string };
      if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    } catch {
      // Fall through to the shared API error helper.
    }
  }
  return getApiErrorMessage(error, fallback);
}
