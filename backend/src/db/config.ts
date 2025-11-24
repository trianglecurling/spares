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

const CONFIG_FILE_PATH = path.join(__dirname, '../data/db-config.json');

export function getDatabaseConfig(): DatabaseConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE_PATH)) {
      return null;
    }
    const configData = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
    return JSON.parse(configData) as DatabaseConfig;
  } catch (error) {
    console.error('Error reading database config:', error);
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

