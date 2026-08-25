/**
 * A volunteer credential grant is valid through its expiration date (inclusive).
 * Missing expiration means the grant does not expire.
 */
export function volunteerCredentialIsValidOn(
  expiresAt: string | null | undefined,
  asOfDate: string
): boolean {
  if (expiresAt == null || expiresAt === '') return true;
  return expiresAt >= asOfDate;
}

export function heldVolunteerCredentialIdsOn(
  grants: Array<{ credentialId: number; expiresAt: string | null }>,
  asOfDate: string
): Set<number> {
  return new Set(
    grants
      .filter((grant) => volunteerCredentialIsValidOn(grant.expiresAt, asOfDate))
      .map((grant) => grant.credentialId)
  );
}
