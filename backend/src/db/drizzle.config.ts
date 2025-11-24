import type { Config } from 'drizzle-kit';
import { getDatabaseConfig } from './config.js';

const dbConfig = getDatabaseConfig();

if (!dbConfig) {
  throw new Error('Database not configured. Run installation first.');
}

let config: Config;

if (dbConfig.type === 'sqlite') {
  config = {
    schema: './src/db/drizzle-schema.ts',
    out: './drizzle',
    driver: 'better-sqlite',
    dbCredentials: {
      url: dbConfig.sqlite?.path || './data/spares.sqlite',
    },
  };
} else {
  config = {
    schema: './src/db/drizzle-schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
      host: dbConfig.postgres!.host,
      port: dbConfig.postgres!.port,
      database: dbConfig.postgres!.database,
      user: dbConfig.postgres!.username,
      password: dbConfig.postgres!.password,
      ssl: dbConfig.postgres!.ssl,
    },
  };
}

export default config;

