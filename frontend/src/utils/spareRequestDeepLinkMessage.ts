const DASHBOARD_HINT = 'See your dashboard for any unfilled spare requests.';

/**
 * Message shown when an email Accept link opens the dashboard and that request
 * is not in the member's open list. Status comes from GET /spares/:id/status.
 */
export function spareRequestDeepLinkAlert(status: string | null | undefined): string {
  switch (status) {
    case 'filled':
      return `Sorry, this spare request has already been filled. ${DASHBOARD_HINT}`;
    case 'cancelled':
      return `Sorry, this spare request has been canceled and is no longer available. ${DASHBOARD_HINT}`;
    case 'open':
      return `Sorry, this spare request is still open, but it is not currently available for you to accept. ${DASHBOARD_HINT}`;
    default:
      return `Sorry, this spare request is not available. ${DASHBOARD_HINT}`;
  }
}

/** Message shown when GET /spares/:id/status fails for an email Accept link. */
export function spareRequestDeepLinkLoadErrorAlert(httpStatus: number | undefined): string {
  if (httpStatus === 404) {
    return `Sorry, this spare request could not be found. ${DASHBOARD_HINT}`;
  }
  if (httpStatus === 403) {
    return `Sorry, this spare request is not available to you. ${DASHBOARD_HINT}`;
  }
  return `Sorry, we could not load that spare request. ${DASHBOARD_HINT}`;
}
