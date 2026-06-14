/** True when date of birth indicates the member is under 18 today (UTC calendar). */
export function isMemberMinor(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return false;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age < 18;
}
