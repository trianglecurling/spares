// Database adapter interface to support both SQLite and PostgreSQL

export interface DatabaseAdapter {
  exec(sql: string): Promise<void> | void;
  prepare(sql: string): PreparedStatement;
  close(): void | Promise<void>;
  transaction<T>(fn: () => T | Promise<T>): T | Promise<T>;
  isAsync(): boolean;
}

export interface PreparedStatement {
  run(...params: any[]): Promise<{ lastInsertRowid?: number | bigint; changes: number }> | { lastInsertRowid?: number | bigint; changes: number };
  get(...params: any[]): Promise<any> | any;
  all(...params: any[]): Promise<any[]> | any[];
}

export interface DatabaseResult {
  lastInsertRowid?: number | bigint;
  changes: number;
}

