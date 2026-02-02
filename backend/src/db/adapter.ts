// Database adapter interface to support both SQLite and PostgreSQL

export interface DatabaseAdapter {
  exec(sql: string): Promise<void> | void;
  prepare<TGet = unknown, TAll = TGet[]>(sql: string): PreparedStatement<TGet, TAll>;
  close(): void | Promise<void>;
  transaction<T>(fn: () => T | Promise<T>): T | Promise<T>;
  isAsync(): boolean;
}

export interface PreparedStatement<TGet = unknown, TAll = TGet[]> {
  run(...params: unknown[]): Promise<DatabaseResult> | DatabaseResult;
  get(...params: unknown[]): Promise<TGet> | TGet;
  all(...params: unknown[]): Promise<TAll> | TAll;
}

export interface DatabaseResult {
  lastInsertRowid?: number | bigint;
  changes: number;
}

