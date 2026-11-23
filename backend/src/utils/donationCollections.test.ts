import { describe, expect, test } from 'bun:test';
import { toCsv } from './csv.js';
import {
  donationCheckoutItemDescription,
  donationCollectionConfirmationContent,
  donationCollectionFeeNote,
  donationCollectionWindowStatus,
  normalizeDonorPhone,
} from './donationCollections.js';

describe('donation collection checkout names', () => {
  test('uses the QuickBooks item name when one is set', () => {
    expect(
      donationCheckoutItemDescription({
        source: 'donation_collection',
        paymentItemName: 'Charity drive 2026',
        causeName: 'Local food bank',
      })
    ).toBe('Charity drive 2026');
  });

  test('falls back to the fundraising cause', () => {
    expect(
      donationCheckoutItemDescription({
        source: 'donation_collection',
        causeName: 'Local food bank',
      })
    ).toBe('Donation — Local food bank');
  });

  test('keeps club donations on the club item name', () => {
    expect(donationCheckoutItemDescription({ source: 'public_donation' })).toBe(
      'Donation to Triangle Curling Club'
    );
  });
});

describe('donation collection window', () => {
  test('is open on the start and end dates', () => {
    expect(donationCollectionWindowStatus('2026-03-01', '2026-03-01', '2026-03-31')).toBe('open');
    expect(donationCollectionWindowStatus('2026-03-31', '2026-03-01', '2026-03-31')).toBe('open');
  });

  test('is upcoming before the start date and ended after the end date', () => {
    expect(donationCollectionWindowStatus('2026-02-28', '2026-03-01', '2026-03-31')).toBe('upcoming');
    expect(donationCollectionWindowStatus('2026-04-01', '2026-03-01', '2026-03-31')).toBe('ended');
  });
});

describe('donation collection confirmation', () => {
  test('includes the fee note and receipt link without tax-deductible language', () => {
    const content = donationCollectionConfirmationContent({
      donorName: 'Ada Lovelace',
      causeName: 'Local food bank',
      collectionName: 'Spring charity spiel',
      amountMinor: 5000,
      currency: 'usd',
      receivedAtLabel: 'March 2, 2026, 3:15 PM',
      receiptUrl: 'https://example.test/payments/order-token',
    });

    expect(content.subject).toBe('Donation confirmation - Local food bank');
    expect(content.text).toContain(donationCollectionFeeNote('Local food bank'));
    expect(content.text).toContain('https://example.test/payments/order-token');
    expect(content.html).toContain('View your receipt');
    expect(content.text).not.toMatch(/tax-deductible|501\(c\)|EIN|tax-exempt/i);
    expect(content.html).not.toMatch(/tax-deductible|501\(c\)|EIN|tax-exempt/i);
  });
});

describe('donor phone', () => {
  test('accepts a normal phone number and rejects short values', () => {
    expect(normalizeDonorPhone('(919) 555-0100')).toBe('(919) 555-0100');
    expect(normalizeDonorPhone('555')).toBeNull();
  });
});

describe('donor csv', () => {
  test('includes donor info, date and time, and amount', () => {
    const csv = toCsv(
      ['Name', 'Email', 'Phone', 'Date and time', 'Amount'],
      [['Ada Lovelace', 'ada@example.com', '919-555-0100', 'March 2, 2026, 3:15 PM', '$50.00']]
    );
    expect(csv).toContain('Name,Email,Phone,Date and time,Amount');
    expect(csv).toContain('Ada Lovelace,ada@example.com,919-555-0100,"March 2, 2026, 3:15 PM",$50.00');
  });
});
