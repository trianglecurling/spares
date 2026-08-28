import { describe, expect, test } from 'bun:test';
import { repairedMemberNameFields } from './memberNameEncodingMigration.js';

describe('repairedMemberNameFields', () => {
  test('repairs mojibake in last name and recomposes display name', () => {
    expect(
      repairedMemberNameFields({
        name: 'Tony D\u00E2\u20AC\u2122Agostino',
        first_name: 'Tony',
        last_name: 'D\u00E2\u20AC\u2122Agostino',
        emergency_contact_name: null,
        name_tag_name: 'Tony D\u00E2\u20AC\u2122Agostino',
        guardian_first_name: null,
        guardian_last_name: null,
      })
    ).toEqual({
      name: "Tony D'Agostino",
      first_name: 'Tony',
      last_name: "D'Agostino",
      emergency_contact_name: null,
      name_tag_name: "Tony D'Agostino",
      guardian_first_name: null,
      guardian_last_name: null,
    });
  });

  test('is a no-op for correctly stored names', () => {
    expect(
      repairedMemberNameFields({
        name: "Tony D'Agostino",
        first_name: 'Tony',
        last_name: "D'Agostino",
        emergency_contact_name: null,
        name_tag_name: 'Tony',
        guardian_first_name: null,
        guardian_last_name: null,
      })
    ).toBeNull();
  });
});
