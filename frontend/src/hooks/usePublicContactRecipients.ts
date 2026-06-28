import { useCallback, useEffect, useState } from 'react';
import api from '../utils/api';
import type { PublicContactRecipientOption } from '../constants/contactRecipients';

type PublicContactRecipientsResponse = PublicContactRecipientOption[];

let cachedRecipients: PublicContactRecipientOption[] | null = null;
let inflight: Promise<PublicContactRecipientOption[]> | null = null;

export async function fetchPublicContactRecipients(options?: {
  force?: boolean;
}): Promise<PublicContactRecipientOption[]> {
  if (!options?.force && cachedRecipients) {
    return cachedRecipients;
  }
  if (!options?.force && inflight) {
    return inflight;
  }

  inflight = api
    .get<PublicContactRecipientsResponse>('/public/contact-recipients')
    .then((response) => {
      const rows = Array.isArray(response.data) ? response.data : [];
      cachedRecipients = rows;
      return rows;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function invalidatePublicContactRecipientsCache(): void {
  cachedRecipients = null;
  inflight = null;
}

export function usePublicContactRecipients() {
  const [recipients, setRecipients] = useState<PublicContactRecipientOption[]>(cachedRecipients ?? []);
  const [loading, setLoading] = useState(cachedRecipients == null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (force = true) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchPublicContactRecipients({ force });
      setRecipients(rows);
    } catch {
      setError('Failed to load contact options');
      setRecipients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cachedRecipients) {
      setRecipients(cachedRecipients);
      setLoading(false);
      return;
    }
    void reload(false);
  }, [reload]);

  return { recipients, loading, error, reload };
}
