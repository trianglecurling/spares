export class WaitlistStaffValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Waitlist staff operation failed');
  }
}
