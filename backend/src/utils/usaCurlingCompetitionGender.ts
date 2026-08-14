export const USA_CURLING_COMPETITION_GENDER_VALUES = ['Male', 'Female', 'Unspecified'] as const;

export type UsaCurlingCompetitionGender = (typeof USA_CURLING_COMPETITION_GENDER_VALUES)[number];

export const USA_CURLING_COMPETITION_GENDER_DEFAULT: UsaCurlingCompetitionGender = 'Unspecified';

export const USA_CURLING_COMPETITION_GENDER_HELP =
  'If you are planning to compete in USA Curling sanctioned events, you may need to specify a competition gender in accordance with USA Curling policy.';

export const USA_CURLING_COMPETITION_GENDER_OPTIONS: Array<{
  value: UsaCurlingCompetitionGender;
  label: string;
}> = [
  { value: 'Unspecified', label: 'Unspecified' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

const GENDER_SET = new Set<string>(USA_CURLING_COMPETITION_GENDER_VALUES);

export function isUsaCurlingCompetitionGender(value: string): value is UsaCurlingCompetitionGender {
  return GENDER_SET.has(value);
}

export function resolveUsaCurlingCompetitionGenderForSave(
  value: string | null | undefined,
): UsaCurlingCompetitionGender {
  const trimmed = (value ?? '').trim();
  if (isUsaCurlingCompetitionGender(trimmed)) return trimmed;
  return USA_CURLING_COMPETITION_GENDER_DEFAULT;
}
