export type RegistrationFinancialAssistanceSummary = {
  requestedPercent: number;
  approvedPercent: number | null;
  status: string;
};

export type RegistrationGuardianSummary = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

export type RegistrationCollectedDetailsFields = {
  studentDiscountClaimed: boolean;
  studentInstitution: string | null;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string | null;
  usaCurlingMembershipOptIn: boolean | null;
  uswcaMembershipOptIn: boolean | null;
  nameTagName: string | null;
  nameTagIncludePronouns: boolean | null;
  nameTagReplacementQuantity: number | null;
  icePrivilegesChoice: 'none' | 'league_play' | 'basic_ice' | null;
  experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing' | null;
  experienceSelfReportedYears: number | null;
  basicIceFallbackInterest: boolean | null;
  financialAssistance: RegistrationFinancialAssistanceSummary | null;
  guardian: RegistrationGuardianSummary | null;
};

export function icePrivilegesChoiceLabel(
  choice: RegistrationCollectedDetailsFields['icePrivilegesChoice'],
): string {
  switch (choice) {
    case 'league_play':
      return 'League play or instructional programs';
    case 'basic_ice':
      return 'Basic ice privileges';
    case 'none':
      return 'None';
    default:
      return 'Not collected';
  }
}

export function experienceLabel(
  experienceType: RegistrationCollectedDetailsFields['experienceType'],
  years: number | null | undefined,
): string {
  if (experienceType === 'specified_years') {
    if (years == null) return 'Has curled before';
    return years === 1 ? '1 year' : `${years} years`;
  }
  if (experienceType === 'known_existing') return 'Club experience on file';
  if (experienceType === 'none_or_minimal') return 'None or minimal';
  return 'Not collected';
}

export function membershipOptInLabel(value: boolean | null | undefined): string {
  if (value === true) return 'Opted in';
  if (value === false) return 'Opted out';
  return 'Not collected';
}

export function nameTagPronounsLabel(value: boolean | null | undefined): string {
  if (value === true) return 'Included';
  if (value === false) return 'Not included';
  return 'Not collected';
}

export function nameTagReplacementLabel(quantity: number | null | undefined): string {
  if (quantity === 0) return 'None purchased';
  if (quantity === 1) return '1 purchased';
  if (quantity === 2 || quantity === 3) return `${quantity} purchased`;
  return 'Not asked';
}

export function financialAssistanceLabel(
  assistance: RegistrationFinancialAssistanceSummary | null | undefined,
): string | null {
  if (!assistance) return null;
  const requested = `${assistance.requestedPercent}% requested`;
  if (assistance.status === 'approved' || assistance.status === 'partially_approved') {
    if (assistance.approvedPercent != null) {
      return `${requested}, ${assistance.approvedPercent}% approved`;
    }
    return `${requested}, approved`;
  }
  if (assistance.status === 'denied') return `${requested}, denied`;
  if (assistance.status === 'withdrawn') return `${requested}, withdrawn`;
  return `${requested}, pending review`;
}

export function guardianName(guardian: RegistrationGuardianSummary): string {
  const name = [guardian.firstName, guardian.lastName].filter(Boolean).join(' ').trim();
  return name || 'Not available';
}

export function studentDiscountLabel(fields: Pick<RegistrationCollectedDetailsFields, 'studentDiscountClaimed' | 'studentInstitution'>): string | null {
  if (!fields.studentDiscountClaimed) return null;
  const institution = fields.studentInstitution?.trim();
  return institution || 'Claimed';
}

export function reciprocalDiscountLabel(
  fields: Pick<RegistrationCollectedDetailsFields, 'reciprocalDiscountClaimed' | 'reciprocalClubName'>,
): string | null {
  if (!fields.reciprocalDiscountClaimed) return null;
  const club = fields.reciprocalClubName?.trim();
  return club || 'Claimed';
}
