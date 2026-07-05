import { isNull, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/** True when a row has been soft-deleted (archived). */
export function isArchivedAt(archivedAt: string | Date | null | undefined): boolean {
  return archivedAt != null && archivedAt !== '';
}

/** SQL condition matching rows that are not archived. */
export function notArchivedCondition<T extends AnyColumn>(archivedAtColumn: T): SQL {
  return isNull(archivedAtColumn);
}
