import path from 'path';
import { splitMemberDisplayName } from '../utils/memberName.js';

const TYPE_SLUGS: Record<string, string> = {
  receipt: 'receipt',
  invoice: 'invoice',
  other_supporting_evidence: 'other',
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

export type ExpenseArchiveDocument = {
  reportId: number;
  submitterName: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
};

export function expenseArchiveReportId(reportId: number): string {
  return String(reportId).padStart(4, '0');
}

/** Last name from the submitter's display name, safe to use in a filename. */
export function expenseArchiveLastName(submitterName: string): string {
  const { firstName, lastName } = splitMemberDisplayName(submitterName);
  const source = lastName || firstName;
  const cleaned = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '');
  return cleaned || 'Unknown';
}

export function expenseDocumentTypeSlug(documentType: string): string {
  return TYPE_SLUGS[documentType] ?? 'other';
}

export function expenseDocumentExtension(originalFilename: string, mimeType: string): string {
  const fromName = path.extname(originalFilename).toLowerCase();
  if (fromName === '.jpeg') return '.jpg';
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? '.bin';
}

/**
 * ER####_{type}{n}_{lastname}.ext
 * The report id is zero-padded to 4 digits. A single document of a type has no number.
 * Multiples are numbered 1, 2, 3 in input order.
 */
export function expenseDocumentArchiveName(
  document: ExpenseArchiveDocument,
  indexAmongType: number,
  typeCount: number
): string {
  const type = expenseDocumentTypeSlug(document.documentType);
  const suffix = typeCount > 1 ? String(indexAmongType) : '';
  const extension = expenseDocumentExtension(document.originalFilename, document.mimeType);
  const reportId = expenseArchiveReportId(document.reportId);
  const lastName = expenseArchiveLastName(document.submitterName);
  return `ER${reportId}_${type}${suffix}_${lastName}${extension}`;
}

export function assignExpenseDocumentArchiveNames<T extends ExpenseArchiveDocument>(
  documents: T[]
): Array<T & { archiveName: string }> {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const key = `${document.reportId}:${expenseDocumentTypeSlug(document.documentType)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return documents.map((document) => {
    const key = `${document.reportId}:${expenseDocumentTypeSlug(document.documentType)}`;
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    return {
      ...document,
      archiveName: expenseDocumentArchiveName(document, index, counts.get(key) ?? 1),
    };
  });
}
