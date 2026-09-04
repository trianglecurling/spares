import axios from 'axios';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { memberHasScope } from './permissions';

export const LEAGUE_PROCESSING_ROSTER_MESSAGE =
  'League rosters are currently being processed by the Membership Committee. Please check back later!';

export const LEAGUE_PROCESSING_MEMBERSHIP_CARD_MESSAGE = 'Currently processing leagues, check back later';

export function memberCanBypassLeagueProcessingHold(
  member: AuthenticatedMember | null | undefined,
): boolean {
  if (!member) return false;
  if (member.isAdmin || member.isServerAdmin) return true;
  if (memberHasScope(member, 'admin.manage')) return true;
  if (memberHasScope(member, 'registrations.manage')) return true;
  if (memberHasScope(member, 'leagues.manage')) return true;
  return false;
}

export function isLeagueProcessingForbiddenError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 403;
}
