/** Shared helpers for soft-deleted (archived) records in the UI. */

export function isArchivedAt(archivedAt: string | null | undefined): boolean {
  return archivedAt != null && archivedAt !== '';
}
