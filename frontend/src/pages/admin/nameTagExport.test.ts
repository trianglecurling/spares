import { describe, expect, test } from 'bun:test';
import { buildNameTagTsv } from './nameTagExport';

describe('buildNameTagTsv', () => {
  test('writes a header and one row per name tag', () => {
    const tsv = buildNameTagTsv([
      {
        nameTagName: 'Alex',
        includePronouns: true,
        pronouns: 'They/Them',
        quantity: 1,
        kind: 'new_member',
        curlerName: 'Alexandra Ng',
      },
      {
        nameTagName: 'Sam\tLee',
        includePronouns: false,
        pronouns: 'He/Him',
        quantity: 2,
        kind: 'paid_replacement',
        curlerName: 'Samuel Lee',
      },
    ]);

    expect(tsv).toBe(
      [
        'Name tag name\tInclude pronouns\tPronouns\tQuantity\tType\tCurler',
        'Alex\tYes\tThey/Them\t1\tNew member\tAlexandra Ng',
        'Sam Lee\tNo\t\t2\tPaid replacement\tSamuel Lee',
      ].join('\n'),
    );
  });
});
