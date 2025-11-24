import Database from 'better-sqlite3';
import { DatabaseAdapter, PreparedStatement } from './adapter.js';

export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: any[]) => {
        const result = stmt.run(...params);
        return {
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes,
        };
      },
      get: (...params: any[]) => stmt.get(...params),
      all: (...params: any[]) => stmt.all(...params),
    };
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  isAsync(): boolean {
    return false;
  }

  // SQLite-specific: Get the underlying database for migrations
  getRawDatabase(): Database.Database {
    return this.db;
  }
}

