import fs from 'fs';
import path from 'path';
import {
  resolveDatabaseConfigFilePath,
  resolveDefaultDatabaseConfigFilePath,
} from '../../db-config-path.js';

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
}

let loggedConfigPath = false;

function logConfigPathOnce(configFilePath: string): void {
  if (loggedConfigPath) {
    return;
  }
  loggedConfigPath = true;
  console.log(`Using database config: ${configFilePath}`);
}

export function getDatabaseConfigFilePath(): string {
  return resolveDatabaseConfigFilePath();
}

export function getDatabaseConfig(): DatabaseConfig | null {
  const configFilePath = resolveDatabaseConfigFilePath();

  try {
    logConfigPathOnce(configFilePath);

    if (!fs.existsSync(configFilePath)) {
      console.error(`Database config file not found at: ${configFilePath}`);
      console.error(`Current working directory: ${process.cwd()}`);
      return null;
    }
    const configData = fs.readFileSync(configFilePath, 'utf-8');
    return JSON.parse(configData) as DatabaseConfig;
  } catch (error) {
    console.error('Error reading database config:', error);
    console.error(`Config file path: ${configFilePath}`);
    console.error(`Current working directory: ${process.cwd()}`);
    return null;
  }
}

export function saveDatabaseConfig(config: DatabaseConfig): void {
  const configFilePath = resolveDefaultDatabaseConfigFilePath();

  try {
    const configDir = path.dirname(configFilePath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving database config:', error);
    throw error;
  }
}

export function isDatabaseConfigured(): boolean {
  return getDatabaseConfig() !== null;
}
