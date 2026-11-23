/** Keep these sentences in sync with `memberEventRegistrationDeniedMessage` on the server. */

export type MemberEventNotice = {
  message: string;
  /** Set when the viewer is signed out and should log in before registering. */
  loginHref: string | null;
};

export function memberEventNotice(
  event: {
    visibility: string;
    viewerCanRegister?: boolean;
    viewerAuthenticated?: boolean;
  },
  loginHref: string,
): MemberEventNotice | null {
  if (event.viewerCanRegister !== false) return null;

  const message =
    event.visibility === 'active_members'
      ? 'This event is available to Triangle Curling members only.'
      : event.visibility === 'ice_members'
        ? 'This event is available to Triangle Curling ice members only.'
        : null;
  if (!message) return null;

  return {
    message,
    loginHref: event.viewerAuthenticated ? null : loginHref,
  };
}
