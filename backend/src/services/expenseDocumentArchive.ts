import path from 'path';

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
  documentType: string;
  originalFilename: string;
  mimeType: string;
};

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
 * ER{reportId}_{type}{n}.{ext}
 * A single document of a type has no number. Multiples are numbered 1, 2, 3 in input order.
 */
export function expenseDocumentArchiveName(
  document: ExpenseArchiveDocument,
  indexAmongType: number,
  typeCount: number
): string {
  const type = expenseDocumentTypeSlug(document.documentType);
  const suffix = typeCount > 1 ? String(indexAmongType) : '';
  const extension = expenseDocumentExtension(document.originalFilename, document.mimeType);
  return `ER${document.reportId}_${type}${suffix}${extension}`;
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
