import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill };

export function isWebAuthnCanceled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  const cause = 'cause' in error && error.cause && typeof error.cause === 'object' ? error.cause : null;
  const causeName = cause && 'name' in cause ? String(cause.name) : '';
  if (name === 'NotAllowedError' || causeName === 'NotAllowedError') return true;
  if (name === 'AbortError' || causeName === 'AbortError') return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('notallowed') || message.includes('timed out') || message.includes('abort');
}

export async function createPasskey(
  options: PublicKeyCredentialCreationOptionsJSON
): Promise<RegistrationResponseJSON> {
  return startRegistration({ optionsJSON: options });
}

export async function assertPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  useBrowserAutofill = false
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({ optionsJSON: options, useBrowserAutofill });
}
