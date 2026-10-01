import { describe, expect, test } from 'bun:test';
import { assignExpenseDocumentArchiveNames } from './expenseDocumentArchive.js';

describe('assignExpenseDocumentArchiveNames', () => {
  test('uses the report id, document type, and extension', () => {
    const [named] = assignExpenseDocumentArchiveNames([
      {
        reportId: 42,
        documentType: 'invoice',
        originalFilename: 'scan.PDF',
        mimeType: 'application/pdf',
      },
    ]);
    expect(named?.archiveName).toBe('ER42_invoice.pdf');
  });

  test('numbers duplicate types on the same report and leaves unique types unnumbered', () => {
    const named = assignExpenseDocumentArchiveNames([
      {
        reportId: 7,
        documentType: 'receipt',
        originalFilename: 'a.jpg',
        mimeType: 'image/jpeg',
      },
      {
        reportId: 7,
        documentType: 'other_supporting_evidence',
        originalFilename: 'note',
        mimeType: 'application/pdf',
      },
      {
        reportId: 7,
        documentType: 'receipt',
        originalFilename: 'b.png',
        mimeType: 'image/png',
      },
      {
        reportId: 8,
        documentType: 'receipt',
        originalFilename: 'only.heic',
        mimeType: 'image/heic',
      },
    ]);
    expect(named.map((document) => document.archiveName)).toEqual([
      'ER7_receipt1.jpg',
      'ER7_other.pdf',
      'ER7_receipt2.png',
      'ER8_receipt.heic',
    ]);
  });

  test('falls back to the mime type when the filename has no extension', () => {
    const [named] = assignExpenseDocumentArchiveNames([
      {
        reportId: 3,
        documentType: 'receipt',
        originalFilename: 'camera-roll',
        mimeType: 'image/jpeg',
      },
    ]);
    expect(named?.archiveName).toBe('ER3_receipt.jpg');
  });
});
