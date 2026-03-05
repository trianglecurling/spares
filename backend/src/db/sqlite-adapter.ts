import { Database } from 'bun:sqlite';
import { DatabaseAdapter, PreparedStatement } from './adapter.js';

export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  prepare<TGet = unknown, TAll = TGet[]>(sql: string): PreparedStatement<TGet, TAll> {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const result = stmt.run(...(params as Parameters<typeof stmt.run>));
        return {
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes,
        };
      },
      get: (...params: unknown[]) => stmt.get(...(params as Parameters<typeof stmt.get>)) as TGet,
      all: (...params: unknown[]) => stmt.all(...(params as Parameters<typeof stmt.all>)) as TAll,
    };
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    const transactionFn = this.db.transaction(() => fn());
    return transactionFn();
  }

  isAsync(): boolean {
    return false;
  }

  // SQLite-specific: Get the underlying database for migrations
  getRawDatabase(): Database {
    return this.db;
  }
}

