import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { memberHasScope } from './permissions';

export function memberHasVolunteeringManageScope(
  member: AuthenticatedMember | null | undefined,
): boolean {
  return memberHasScope(member, 'volunteering.manage');
}

export function memberManagedVolunteerProgramIds(
  member: AuthenticatedMember | null | undefined,
): number[] {
  return member?.managedVolunteerProgramIds ?? [];
}

export function memberManagesAnyVolunteerProgram(
  member: AuthenticatedMember | null | undefined,
): boolean {
  return memberManagedVolunteerProgramIds(member).length > 0;
}

/** Global volunteering admin or manages at least one program (list / nav entry). */
export function memberCanAccessVolunteeringAdmin(
  member: AuthenticatedMember | null | undefined,
): boolean {
  return memberHasVolunteeringManageScope(member) || memberManagesAnyVolunteerProgram(member);
}

/** Can open /admin/volunteering/:id for this program id from session claims. */
export function memberCanManageVolunteerProgramFromClaims(
  member: AuthenticatedMember | null | undefined,
  programId: number,
): boolean {
  if (memberHasVolunteeringManageScope(member)) return true;
  return memberManagedVolunteerProgramIds(member).includes(programId);
}
