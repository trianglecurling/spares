import { describe, expect, test } from 'bun:test';
import {
  USA_CURLING_COMPETITION_GENDER_DEFAULT,
  resolveUsaCurlingCompetitionGenderForSave,
} from './usaCurlingCompetitionGender.js';

describe('USA Curling competition gender', () => {
  test('keeps Male and Female', () => {
    expect(resolveUsaCurlingCompetitionGenderForSave('Male')).toBe('Male');
    expect(resolveUsaCurlingCompetitionGenderForSave('Female')).toBe('Female');
  });

  test('defaults blank or unknown values to Unspecified', () => {
    expect(resolveUsaCurlingCompetitionGenderForSave('')).toBe(USA_CURLING_COMPETITION_GENDER_DEFAULT);
    expect(resolveUsaCurlingCompetitionGenderForSave(null)).toBe(USA_CURLING_COMPETITION_GENDER_DEFAULT);
    expect(resolveUsaCurlingCompetitionGenderForSave('Other')).toBe(USA_CURLING_COMPETITION_GENDER_DEFAULT);
    expect(resolveUsaCurlingCompetitionGenderForSave('Unspecified')).toBe('Unspecified');
  });
});
