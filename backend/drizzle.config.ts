import type { Config } from 'drizzle-kit';
import fs from 'fs';
import { resolveDatabaseConfigFilePath } from './db-config-path.ts';

// Read db config directly to avoid import resolution issues with drizzle-kit
const configPath = resolveDatabaseConfigFilePath();
console.log(`Using database config: ${configPath}`);

if (!fs.existsSync(configPath)) {
  throw new Error('Database not configured. Run installation first. Config file not found at: ' + configPath);
}

const configData = fs.readFileSync(configPath, 'utf-8');
const dbConfig = JSON.parse(configData);

if (!dbConfig || !dbConfig.type) {
  throw new Error('Invalid database configuration');
}

let config: Config;

if (dbConfig.type === 'sqlite') {
  config = {
    schema: './src/db/drizzle-schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    migrations: {
      table: '__drizzle_migrations',
      schema: 'public',
    },
    dbCredentials: {
      url: dbConfig.sqlite?.path || './data/spares.sqlite',
    },
  };
} else if (dbConfig.type === 'postgres') {
  if (!dbConfig.postgres) {
    throw new Error('PostgreSQL configuration missing');
  }
  config = {
    schema: './src/db/drizzle-schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    migrations: {
      table: '__drizzle_migrations',
      schema: 'public',
    },
    dbCredentials: {
      host: dbConfig.postgres.host,
      port: dbConfig.postgres.port,
      database: dbConfig.postgres.database,
      user: dbConfig.postgres.username,
      password: dbConfig.postgres.password,
      ssl: dbConfig.postgres.ssl,
    },
  };
} else {
  throw new Error(`Unsupported database type: ${dbConfig.type}`);
}

export default config;

