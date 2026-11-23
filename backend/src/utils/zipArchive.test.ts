import { crc32 } from 'node:zlib';
import { describe, expect, test } from 'bun:test';
import { createStoredZip } from './zipArchive.js';

function readStoredZip(zip: Buffer): Array<{ name: string; data: Buffer }> {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;
  while (offset + 30 <= zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    expect(signature).toBe(0x04034b50);
    const method = zip.readUInt16LE(offset + 8);
    const storedCrc = zip.readUInt32LE(offset + 14);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const data = Buffer.from(zip.subarray(dataStart, dataStart + size));
    expect(method).toBe(0);
    expect(crc32(data) >>> 0).toBe(storedCrc);
    entries.push({
      name: zip.subarray(nameStart, nameStart + nameLength).toString('utf8'),
      data,
    });
    offset = dataStart + size;
  }
  return entries;
}

describe('createStoredZip', () => {
  test('round-trips stored file names and bytes', () => {
    const zip = createStoredZip([
      { name: 'ER12_receipt.pdf', data: Buffer.from('receipt-a') },
      { name: 'ER12_invoice.jpg', data: Buffer.from('invoice-b') },
    ]);
    expect(readStoredZip(zip)).toEqual([
      { name: 'ER12_receipt.pdf', data: Buffer.from('receipt-a') },
      { name: 'ER12_invoice.jpg', data: Buffer.from('invoice-b') },
    ]);
  });
});
