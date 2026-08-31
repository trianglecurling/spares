export const SYSTEM_CREDENTIAL_KEYS = {
  currentMember: 'current_member',
  hasIcePrivileges: 'has_ice_privileges',
  over18: 'over_18',
  over21: 'over_21',
} as const;

export type SystemCredentialKey = (typeof SYSTEM_CREDENTIAL_KEYS)[keyof typeof SYSTEM_CREDENTIAL_KEYS];

export type SystemCredentialDefinition = {
  key: SystemCredentialKey;
  name: string;
  description: string;
  pointOfContactEmail: string;
  grantRule: string;
};

const SYSTEM_CREDENTIAL_KEY_SET = new Set<string>(Object.values(SYSTEM_CREDENTIAL_KEYS));

export const SYSTEM_CREDENTIAL_DEFINITIONS: SystemCredentialDefinition[] = [
  {
    key: SYSTEM_CREDENTIAL_KEYS.currentMember,
    name: 'Current member',
    description:
      'Automatically granted while you have an active regular, social, or junior recreational membership. Lifetime members also qualify.',
    pointOfContactEmail: 'membership@trianglecurling.com',
    grantRule:
      'Granted automatically to current members (regular, social, junior recreational, or lifetime).',
  },
  {
    key: SYSTEM_CREDENTIAL_KEYS.hasIcePrivileges,
    name: 'Has ice privileges',
    description: 'Automatically granted while you have on-ice access for the current membership period.',
    pointOfContactEmail: 'membership@trianglecurling.com',
    grantRule: 'Granted automatically to members with ice privileges.',
  },
  {
    key: SYSTEM_CREDENTIAL_KEYS.over18,
    name: 'Over 18',
    description: 'Automatically granted when your date of birth shows you are 18 or older.',
    pointOfContactEmail: 'membership@trianglecurling.com',
    grantRule: 'Granted automatically to members who are 18 or older.',
  },
  {
    key: SYSTEM_CREDENTIAL_KEYS.over21,
    name: 'Over 21',
    description: 'Automatically granted when your date of birth shows you are 21 or older.',
    pointOfContactEmail: 'membership@trianglecurling.com',
    grantRule: 'Granted automatically to members who are 21 or older.',
  },
];

const DEFINITION_BY_KEY = new Map(SYSTEM_CREDENTIAL_DEFINITIONS.map((definition) => [definition.key, definition]));

export type SystemCredentialFacts = {
  isCurrentMember: boolean;
  hasIcePrivileges: boolean;
  ageYears: number | null;
};

export function isSystemCredentialKey(value: string | null | undefined): value is SystemCredentialKey {
  return typeof value === 'string' && SYSTEM_CREDENTIAL_KEY_SET.has(value);
}

export function parseSystemCredentialKey(value: unknown): SystemCredentialKey | null {
  if (typeof value !== 'string') return null;
  return isSystemCredentialKey(value) ? value : null;
}

export function systemCredentialDefinition(key: SystemCredentialKey): SystemCredentialDefinition {
  const definition = DEFINITION_BY_KEY.get(key);
  if (!definition) {
    throw new Error(`Unknown system credential: ${key}`);
  }
  return definition;
}

export function memberHoldsSystemCredential(key: SystemCredentialKey, facts: SystemCredentialFacts): boolean {
  switch (key) {
    case SYSTEM_CREDENTIAL_KEYS.currentMember:
      return facts.isCurrentMember;
    case SYSTEM_CREDENTIAL_KEYS.hasIcePrivileges:
      return facts.hasIcePrivileges;
    case SYSTEM_CREDENTIAL_KEYS.over18:
      return facts.ageYears != null && facts.ageYears >= 18;
    case SYSTEM_CREDENTIAL_KEYS.over21:
      return facts.ageYears != null && facts.ageYears >= 21;
    default:
      return false;
  }
}
