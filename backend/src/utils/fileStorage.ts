import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { config } from '../config.js';

export type StoredFileStat = {
  size: number;
  mtimeMs: number;
};

export interface FileStorageAdapter {
  put(storageKey: string, data: Buffer): Promise<void>;
  getReadStream(storageKey: string): Promise<fs.ReadStream>;
  stat(storageKey: string): Promise<StoredFileStat>;
  delete(storageKey: string): Promise<void>;
}

class LocalFileStorageAdapter implements FileStorageAdapter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  private resolvePath(storageKey: string): string {
    return path.join(this.rootDir, storageKey);
  }

  private async ensureParentDir(storageKey: string): Promise<void> {
    const targetDir = path.dirname(this.resolvePath(storageKey));
    await fsPromises.mkdir(targetDir, { recursive: true });
  }

  async put(storageKey: string, data: Buffer): Promise<void> {
    await this.ensureParentDir(storageKey);
    await fsPromises.writeFile(this.resolvePath(storageKey), data);
  }

  async getReadStream(storageKey: string): Promise<fs.ReadStream> {
    const filePath = this.resolvePath(storageKey);
    await fsPromises.access(filePath, fs.constants.R_OK);
    return fs.createReadStream(filePath);
  }

  async stat(storageKey: string): Promise<StoredFileStat> {
    const stats = await fsPromises.stat(this.resolvePath(storageKey));
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }

  async delete(storageKey: string): Promise<void> {
    await fsPromises.unlink(this.resolvePath(storageKey));
  }
}

let storageAdapter: FileStorageAdapter | null = null;

export function getFileStorageAdapter(): FileStorageAdapter {
  if (!storageAdapter) {
    storageAdapter = new LocalFileStorageAdapter(config.fileStoragePath);
  }
  return storageAdapter;
}
