/** Spots held by confirmed registrations and non-expired pending waitlist offers. */
export function computeOpenSpotsFromDemand(
  capacity: number | null,
  registrationDemandCount: number,
): number | null {
  if (capacity === null) return null;
  return Math.max(0, capacity - registrationDemandCount);
}

/** Whether a new registration of groupSize can confirm directly (not waitlist). */
export function hasDirectRegistrationCapacity(
  capacity: number | null,
  registrationDemandCount: number,
  groupSize: number,
): boolean {
  if (capacity === null) return true;
  return registrationDemandCount + groupSize <= capacity;
}
