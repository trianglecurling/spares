import type { MemberProfileResponse } from '../../../backend/src/api/types';
import { isMemberMinor } from './memberAge';

export type MemberGuardianFormFields = {
  guardianFirstName: string;
  guardianLastName: string;
  guardianEmail: string;
  guardianPhone: string;
};

export const emptyMemberGuardianForm = (): MemberGuardianFormFields => ({
  guardianFirstName: '',
  guardianLastName: '',
  guardianEmail: '',
  guardianPhone: '',
});

export function memberGuardianFormFromProfile(profile: MemberProfileResponse): MemberGuardianFormFields {
  return {
    guardianFirstName: profile.guardianFirstName || '',
    guardianLastName: profile.guardianLastName || '',
    guardianEmail: profile.guardianEmail || '',
    guardianPhone: profile.guardianPhone || '',
  };
}

export function memberGuardianFormIsComplete(form: MemberGuardianFormFields): boolean {
  return (
    form.guardianFirstName.trim() !== '' &&
    form.guardianLastName.trim() !== '' &&
    form.guardianEmail.trim() !== '' &&
    form.guardianPhone.trim() !== ''
  );
}

export function memberGuardianPayloadForSave(form: MemberGuardianFormFields) {
  return {
    guardianFirstName: form.guardianFirstName.trim(),
    guardianLastName: form.guardianLastName.trim(),
    guardianEmail: form.guardianEmail.trim(),
    guardianPhone: form.guardianPhone.trim(),
  };
}

export { isMemberMinor };
