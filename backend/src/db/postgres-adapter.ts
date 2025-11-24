import { Pool, Client } from 'pg';
import { DatabaseAdapter, PreparedStatement } from './adapter.js';

export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool;
  private preparedStatements: Map<string, string> = new Map();

  constructor(config: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
  }) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
    });
  }

  async exec(sql: string): Promise<void> {
    const pgSql = this.convertSQLiteToPostgres(sql);
    await this.pool.query(pgSql);
  }

  prepare(sql: string): PreparedStatement {
    // Convert SQLite syntax to PostgreSQL
    const pgSql = this.convertSQLiteToPostgres(sql);
    
    return {
      run: async (...params: any[]) => {
        // Convert ? placeholders to $1, $2, etc. and get the converted SQL
        const { convertedSql } = this.convertParameters(pgSql, params.length);
        
        // For INSERT statements, add RETURNING id to get lastInsertRowid
        let querySql = convertedSql;
        if (convertedSql.trim().toUpperCase().startsWith('INSERT')) {
          // Check if RETURNING clause already exists
          if (!/RETURNING/i.test(querySql)) {
            querySql = querySql.replace(/;?\s*$/, '') + ' RETURNING id';
          }
        }
        
        // Parameters stay in the same order (first ? becomes $1, second ? becomes $2, etc.)
        const result = await this.pool.query(querySql, params);
        return {
          lastInsertRowid: result.rows[0]?.id || undefined,
          changes: result.rowCount || 0,
        };
      },
      get: async (...params: any[]) => {
        const { convertedSql } = this.convertParameters(pgSql, params.length);
        const result = await this.pool.query(convertedSql, params);
        return result.rows[0] || null;
      },
      all: async (...params: any[]) => {
        const { convertedSql } = this.convertParameters(pgSql, params.length);
        const result = await this.pool.query(convertedSql, params);
        return result.rows;
      },
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.transactionAsync(async () => {
      return fn();
    });
  }

  isAsync(): boolean {
    return true;
  }

  async transactionAsync<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  private convertSQLiteToPostgres(sql: string): string {
    let pgSql = sql;
    
    // Convert INTEGER PRIMARY KEY AUTOINCREMENT to SERIAL PRIMARY KEY
    pgSql = pgSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    
    // Convert INTEGER PRIMARY KEY to SERIAL PRIMARY KEY (but not AUTOINCREMENT)
    pgSql = pgSql.replace(/INTEGER PRIMARY KEY(?!\s+AUTOINCREMENT)/gi, 'SERIAL PRIMARY KEY');
    
    // Convert DATETIME to TIMESTAMP
    pgSql = pgSql.replace(/DATETIME/gi, 'TIMESTAMP');
    
    // Convert datetime('now') to CURRENT_TIMESTAMP
    pgSql = pgSql.replace(/datetime\s*\(\s*['"]now['"]\s*\)/gi, 'CURRENT_TIMESTAMP');
    
    // Convert LOWER() function calls - PostgreSQL uses LOWER() the same way, but ensure proper syntax
    // LOWER() is already compatible, but we need to handle it in WHERE clauses
    
    // Convert DATE stays DATE
    // Convert TIME stays TIME
    // Convert TEXT stays TEXT
    
    // Convert CHECK constraints syntax (mostly the same)
    
    // Convert INSERT OR IGNORE to INSERT ... ON CONFLICT DO NOTHING
    pgSql = pgSql.replace(/INSERT OR IGNORE INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi, 
      (match, table, columns, values) => {
        return `INSERT INTO ${table} (${columns}) VALUES (${values}) ON CONFLICT DO NOTHING`;
      });
    
    // Convert lastInsertRowid to RETURNING id
    // This is handled in the run() method
    
    return pgSql;
  }

  // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
  private convertParameters(sql: string, paramCount: number): { convertedSql: string; paramMapping: number[] } {
    let convertedSql = sql;
    const paramMapping: number[] = [];
    let paramIndex = 1;
    
    // Replace all ? placeholders with $1, $2, etc.
    convertedSql = convertedSql.replace(/\?/g, () => {
      const pgParam = `$${paramIndex}`;
      const originalIndex = paramIndex - 1;
      paramMapping.push(originalIndex); // Map to original parameter index (0-based)
      paramIndex++;
      return pgParam;
    });
    
    // The paramMapping is just [0, 1, 2, ...] since we're mapping in order
    // But we return it anyway for clarity
    return { convertedSql, paramMapping };
  }

  // Helper to execute raw SQL (for schema creation)
  async query(sql: string, params?: any[]): Promise<any> {
    const pgSql = this.convertSQLiteToPostgres(sql);
    if (params && params.length > 0) {
      const { convertedSql, paramMapping } = this.convertParameters(pgSql, params.length);
      const mappedParams = paramMapping.map(i => params[i]);
      return this.pool.query(convertedSql, mappedParams);
    }
    return this.pool.query(pgSql, params);
  }
}

