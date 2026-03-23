export const STRUCTURED_COMMITTEE_CONTACT_PREFIX = '__governance_contact_v1__:';

export interface ParsedCommitteeContactInfo {
  emails: string[];
  slackChannels: string[];
  note: string | null;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

export function serializeCommitteeContactInfo(input: ParsedCommitteeContactInfo): string | null {
  const emails = unique(input.emails.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const slackChannels = unique(
    input.slackChannels
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => (value.startsWith('#') ? value : `#${value}`))
  );
  const note = input.note?.trim() || null;

  if (emails.length === 0 && slackChannels.length === 0 && !note) return null;

  return `${STRUCTURED_COMMITTEE_CONTACT_PREFIX}${JSON.stringify({
    emails,
    slackChannels,
    note,
  })}`;
}

export function deserializeCommitteeContactInfo(value: string | null): ParsedCommitteeContactInfo {
  if (!value) {
    return { emails: [], slackChannels: [], note: null };
  }

  if (value.startsWith(STRUCTURED_COMMITTEE_CONTACT_PREFIX)) {
    try {
      const payload = JSON.parse(value.slice(STRUCTURED_COMMITTEE_CONTACT_PREFIX.length)) as {
        emails?: unknown;
        slackChannels?: unknown;
        note?: unknown;
      };
      const emails = Array.isArray(payload.emails)
        ? payload.emails.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
        : [];
      const slackChannels = Array.isArray(payload.slackChannels)
        ? payload.slackChannels
            .map((entry) => String(entry).trim())
            .filter(Boolean)
            .map((entry) => (entry.startsWith('#') ? entry : `#${entry}`))
        : [];
      const note = typeof payload.note === 'string' && payload.note.trim() ? payload.note.trim() : null;
      return { emails: unique(emails), slackChannels: unique(slackChannels), note };
    } catch {
      return { emails: [], slackChannels: [], note: value };
    }
  }

  return {
    emails: [],
    slackChannels: [],
    note: value,
  };
}
