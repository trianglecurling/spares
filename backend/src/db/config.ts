import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DatabaseConfig {
  type: 'sqlite' | 'postgres';
  sqlite?: {
    path: string;
  };
  postgres?: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
  };
  adminEmails: string[];
}

// Resolve config file path relative to the backend directory (where process.cwd() points)
// This works both in development (src/) and production (dist/)
// In production, process.cwd() is /srv/spares/backend, so data/db-config.json resolves correctly
const CONFIG_FILE_PATH = path.resolve(process.cwd(), 'data/db-config.json');

export function getDatabaseConfig(): DatabaseConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE_PATH)) {
      console.error(`Database config file not found at: ${CONFIG_FILE_PATH}`);
      console.error(`Current working directory: ${process.cwd()}`);
      return null;
    }
    const configData = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
    return JSON.parse(configData) as DatabaseConfig;
  } catch (error) {
    console.error('Error reading database config:', error);
    console.error(`Config file path: ${CONFIG_FILE_PATH}`);
    console.error(`Current working directory: ${process.cwd()}`);
    return null;
  }
}

export function saveDatabaseConfig(config: DatabaseConfig): void {
  try {
    const configDir = path.dirname(CONFIG_FILE_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving database config:', error);
    throw error;
  }
}

export function isDatabaseConfigured(): boolean {
  return getDatabaseConfig() !== null;
}

