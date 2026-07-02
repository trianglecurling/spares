import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const DEFAULT_CONFIG_FILE_NAME = 'db-config.json';

export function getDatabaseConfigProfile(): string | undefined {
  const profile = process.env.DB_CONFIG_PROFILE?.trim();
  if (!profile) {
    return undefined;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error(`Invalid DB_CONFIG_PROFILE: ${profile}`);
  }
  return profile;
}

export function resolveDatabaseConfigFilePath(): string {
  const profile = getDatabaseConfigProfile();
  const fileName = profile ? `db-config.${profile}.json` : DEFAULT_CONFIG_FILE_NAME;
  return path.resolve(process.cwd(), 'data', fileName);
}

export function resolveDefaultDatabaseConfigFilePath(): string {
  return path.resolve(process.cwd(), 'data', DEFAULT_CONFIG_FILE_NAME);
}
