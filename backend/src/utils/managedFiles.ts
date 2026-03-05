import path from 'path';
import { createHash, randomUUID } from 'crypto';

export type FileVisibility = 'public' | 'authenticated';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
};

export function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  const basename = path.basename(trimmed || 'file');
  return basename.replace(/[^\w.\-() ]+/g, '_').slice(0, 255) || 'file';
}

export function makeFileSlug(filename: string): string {
  const base = sanitizeFilename(filename);
  return base
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.\-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'file';
}

function withVersionQuery(url: string, checksumSha256?: string | null): string {
  if (!checksumSha256) return url;
  return `${url}?v=${encodeURIComponent(checksumSha256)}`;
}

export function publicFileUrl(id: number, filename: string, checksumSha256?: string | null): string {
  return withVersionQuery(`/api/public/files/${id}/${makeFileSlug(filename)}`, checksumSha256);
}

export function authFileUrl(id: number, filename: string, checksumSha256?: string | null): string {
  return withVersionQuery(`/api/files/${id}/${makeFileSlug(filename)}`, checksumSha256);
}

export function detectMimeType(uploadedMimeType: string | undefined, filename: string): string {
  if (uploadedMimeType && uploadedMimeType.includes('/')) {
    return uploadedMimeType;
  }
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
}

export function createStorageKey(filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(0, 12);
  const ymd = new Date().toISOString().slice(0, 10);
  return `${ymd}/${randomUUID()}${ext}`;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function shouldUseInlineContentDisposition(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('text/') || mimeType === 'application/pdf';
}
