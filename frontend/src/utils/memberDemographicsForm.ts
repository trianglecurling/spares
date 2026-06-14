import type { MemberProfileResponse } from '../../../backend/src/api/types';
import { isMemberMinor } from './memberAge';
import {
  defaultRegistrationMailingAddressFormFields,
  parseRegistrationMailingAddressStored,
  registrationMailingAddressIsComplete,
  serializeRegistrationMailingAddress,
  type RegistrationMailingAddressFormFields,
} from './registrationMailingAddress';

export type MemberDemographicsFormFields = RegistrationMailingAddressFormFields & {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export const emptyMemberDemographicsForm = (): MemberDemographicsFormFields => ({
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  ...defaultRegistrationMailingAddressFormFields(),
  emergencyContactName: '',
  emergencyContactPhone: '',
});

export function memberDemographicsFormFromProfile(profile: MemberProfileResponse): MemberDemographicsFormFields {
  const [firstFallback = '', ...lastParts] = profile.name.split(' ');
  const mailingParts = parseRegistrationMailingAddressStored(profile.mailingAddress);
  return {
    firstName: profile.firstName || firstFallback,
    lastName: profile.lastName || lastParts.join(' '),
    dateOfBirth: profile.dateOfBirth || '',
    email: profile.email || '',
    phone: profile.phone || '',
    ...mailingParts,
    emergencyContactName: profile.emergencyContactName || '',
    emergencyContactPhone: profile.emergencyContactPhone || '',
  };
}

export function memberDemographicsPayloadForSave(form: MemberDemographicsFormFields) {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    dateOfBirth: form.dateOfBirth,
    email: form.email,
    phone: form.phone,
    mailingAddress: serializeRegistrationMailingAddress(form),
    emergencyContactName: form.emergencyContactName,
    emergencyContactPhone: form.emergencyContactPhone,
  };
}

export function memberDemographicsSignInEmailIsComplete(form: MemberDemographicsFormFields): boolean {
  return form.email.trim() !== '';
}

export function memberDemographicsPersonalFormIsComplete(form: MemberDemographicsFormFields): boolean {
  return (
    form.firstName.trim() !== '' &&
    form.lastName.trim() !== '' &&
    form.dateOfBirth.trim() !== '' &&
    form.phone.trim() !== '' &&
    registrationMailingAddressIsComplete(form)
  );
}

export function memberDemographicsEmergencyFormIsComplete(form: MemberDemographicsFormFields): boolean {
  if (isMemberMinor(form.dateOfBirth)) return true;
  return form.emergencyContactName.trim() !== '' && form.emergencyContactPhone.trim() !== '';
}

export function memberDemographicsFormIsComplete(form: MemberDemographicsFormFields): boolean {
  return (
    memberDemographicsSignInEmailIsComplete(form) &&
    memberDemographicsPersonalFormIsComplete(form) &&
    memberDemographicsEmergencyFormIsComplete(form)
  );
}
