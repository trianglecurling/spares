import { describe, expect, test } from 'bun:test';
import { assignExpenseDocumentArchiveNames } from './expenseDocumentArchive.js';

describe('assignExpenseDocumentArchiveNames', () => {
  test('pads the report id and appends the submitter last name', () => {
    const [named] = assignExpenseDocumentArchiveNames([
      {
        reportId: 4,
        submitterName: 'Jane Doe',
        documentType: 'invoice',
        originalFilename: 'scan.PDF',
        mimeType: 'application/pdf',
      },
    ]);
    expect(named?.archiveName).toBe('ER0004_invoice_Doe.pdf');
  });

  test('numbers duplicate types on the same report and leaves unique types unnumbered', () => {
    const named = assignExpenseDocumentArchiveNames([
      {
        reportId: 7,
        submitterName: 'Alex Ng',
        documentType: 'receipt',
        originalFilename: 'a.jpg',
        mimeType: 'image/jpeg',
      },
      {
        reportId: 7,
        submitterName: 'Alex Ng',
        documentType: 'other_supporting_evidence',
        originalFilename: 'note',
        mimeType: 'application/pdf',
      },
      {
        reportId: 7,
        submitterName: 'Alex Ng',
        documentType: 'receipt',
        originalFilename: 'b.png',
        mimeType: 'image/png',
      },
      {
        reportId: 8,
        submitterName: "Pat O'Brien",
        documentType: 'receipt',
        originalFilename: 'only.heic',
        mimeType: 'image/heic',
      },
    ]);
    expect(named.map((document) => document.archiveName)).toEqual([
      'ER0007_receipt1_Ng.jpg',
      'ER0007_other_Ng.pdf',
      'ER0007_receipt2_Ng.png',
      'ER0008_receipt_OBrien.heic',
    ]);
  });

  test('falls back to the mime type when the filename has no extension', () => {
    const [named] = assignExpenseDocumentArchiveNames([
      {
        reportId: 3,
        submitterName: 'Sam Rivera',
        documentType: 'receipt',
        originalFilename: 'camera-roll',
        mimeType: 'image/jpeg',
      },
    ]);
    expect(named?.archiveName).toBe('ER0003_receipt_Rivera.jpg');
  });

  test('uses the whole surname when it has more than one word', () => {
    const [named] = assignExpenseDocumentArchiveNames([
      {
        reportId: 12,
        submitterName: 'John Van Dyke',
        documentType: 'receipt',
        originalFilename: 'receipt.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    expect(named?.archiveName).toBe('ER0012_receipt_VanDyke.pdf');
  });
});
