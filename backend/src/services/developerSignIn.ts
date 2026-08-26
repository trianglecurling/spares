import { isServiceAccount } from '../utils/accountKind.js';

export type DeveloperSignInDenial =
  | 'impersonating'
  | 'not_server_admin'
  | 'target_not_found'
  | 'service_account'
  | 'same_member';

export function evaluateDeveloperSignIn(input: {
  actorIsServerAdmin: boolean;
  actorIsImpersonating: boolean;
  actorMemberId: number;
  target: { id: number; account_kind?: string | null } | null;
}): DeveloperSignInDenial | null {
  if (input.actorIsImpersonating) return 'impersonating';
  if (!input.actorIsServerAdmin) return 'not_server_admin';
  if (!input.target) return 'target_not_found';
  if (isServiceAccount(input.target)) return 'service_account';
  if (input.actorMemberId === input.target.id) return 'same_member';
  return null;
}

export function developerSignInErrorStatus(reason: DeveloperSignInDenial): number {
  switch (reason) {
    case 'impersonating':
    case 'not_server_admin':
      return 403;
    case 'target_not_found':
      return 404;
    case 'service_account':
    case 'same_member':
      return 400;
  }
}

export function developerSignInErrorMessage(reason: DeveloperSignInDenial): string {
  switch (reason) {
    case 'impersonating':
    case 'not_server_admin':
      return 'Forbidden';
    case 'target_not_found':
      return 'Member not found';
    case 'service_account':
      return 'Cannot sign in as a service account';
    case 'same_member':
      return 'Already signed in as this member';
  }
}
