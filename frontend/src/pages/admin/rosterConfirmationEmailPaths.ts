export function rosterConfirmationEmailPreviewPath(memberId: number, sessionId?: number | null): string {
  const query = sessionId ? `?sessionId=${encodeURIComponent(String(sessionId))}` : '';
  return `/admin/registrations/roster-emails/${memberId}${query}`;
}

export function rosterConfirmationEmailListPath(sessionId?: number | null): string {
  const query = sessionId ? `?sessionId=${encodeURIComponent(String(sessionId))}` : '';
  return `/admin/registrations/roster-emails${query}`;
}
