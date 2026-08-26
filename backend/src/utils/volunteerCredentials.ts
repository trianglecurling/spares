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

export function memberHasAllVolunteerCredentials(
  heldCredentialIds: Iterable<number>,
  required: Array<{ id: number }>
): boolean {
  const held = heldCredentialIds instanceof Set ? heldCredentialIds : new Set(heldCredentialIds);
  return required.every((credential) => held.has(credential.id));
}

/**
 * Hub discovery: a program appears only if the member qualifies for at least
 * one of its roles (holds every credential that role requires). Roles with no
 * credential requirement always qualify. Programs with no roles stay visible.
 */
export function volunteerProgramVisibleGivenCredentials(
  program: { roles: Array<{ requiredCredentials: Array<{ id: number }> }> },
  heldCredentialIds: Iterable<number>
): boolean {
  const roles = program.roles;
  if (roles.length === 0) return true;
  const held = heldCredentialIds instanceof Set ? heldCredentialIds : new Set(heldCredentialIds);
  return roles.some((role) => memberHasAllVolunteerCredentials(held, role.requiredCredentials));
}
