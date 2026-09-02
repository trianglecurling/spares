import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const DEFAULT_CONFIG_FILE_NAME = 'db-config.json';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function getDatabaseConfigFileName(profile?: string): string {
  const normalized = profile?.trim();
  if (!normalized || normalized === 'default') {
    return DEFAULT_CONFIG_FILE_NAME;
  }
  if (!PROFILE_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid DB_CONFIG_PROFILE: ${normalized}`);
  }
  return `db-config.${normalized}.json`;
}

export function getDatabaseConfigProfile(): string | undefined {
  const profile = process.env.DB_CONFIG_PROFILE?.trim();
  if (!profile) {
    return undefined;
  }
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid DB_CONFIG_PROFILE: ${profile}`);
  }
  return profile;
}

export function resolveDatabaseConfigFilePath(): string {
  return path.resolve(process.cwd(), 'data', getDatabaseConfigFileName(getDatabaseConfigProfile()));
}

export function resolveDefaultDatabaseConfigFilePath(): string {
  return path.resolve(process.cwd(), 'data', DEFAULT_CONFIG_FILE_NAME);
}
