export type GovernanceOfficerPosition = 'president' | 'vice_president' | 'treasurer' | 'secretary';

export interface GovernanceSettings {
  fiscalYearStartMmdd: string;
  boardTurnoverMmdd: string;
}

export interface GovernanceBoardMember {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string | null;
  publicEmail: string | null;
  effectivePublicEmail: string | null;
  firstFiscalYear: number;
  lastFiscalYear: number;
  manualInactive: boolean;
  derivedActive: boolean;
  isActive: boolean;
  committeeIds: number[];
}

export interface GovernanceOfficer {
  position: GovernanceOfficerPosition;
  boardMemberId: number;
}

export interface GovernanceCommitteeChair {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string | null;
  publicEmail: string | null;
  effectivePublicEmail: string | null;
}

export interface GovernanceCommittee {
  id: number;
  name: string;
  boardLiaisonBoardMemberId: number | null;
  contactInfo: string | null;
  responsibilities: string | null;
  chairs: GovernanceCommitteeChair[];
}

export interface GovernanceSummaryResponse {
  today: string;
  currentFiscalYear: number;
  currentBoardYear: number;
  settings: GovernanceSettings;
  boardMembers: GovernanceBoardMember[];
  officers: GovernanceOfficer[];
  committees: GovernanceCommittee[];
}

export const OFFICER_LABELS: Record<GovernanceOfficerPosition, string> = {
  president: 'President',
  vice_president: 'Vice-President',
  treasurer: 'Treasurer',
  secretary: 'Secretary',
};

