import { useCallback, useEffect, useState } from 'react';
import api from '../utils/api';
import type { AdminContactRecipientOption, PublicContactRecipientOption } from '../constants/contactRecipients';

type PublicContactRecipientsResponse = PublicContactRecipientOption[];

const cachedRecipientsByInclude = new Map<string, PublicContactRecipientOption[]>();
const inflightByInclude = new Map<string, Promise<PublicContactRecipientOption[]>>();

function cacheKey(includeRecipient?: string | null): string {
  return includeRecipient?.trim() || '';
}

export async function fetchPublicContactRecipients(options?: {
  force?: boolean;
  includeRecipient?: string | null;
}): Promise<PublicContactRecipientOption[]> {
  const key = cacheKey(options?.includeRecipient);
  if (!options?.force && cachedRecipientsByInclude.has(key)) {
    return cachedRecipientsByInclude.get(key)!;
  }
  const inflight = inflightByInclude.get(key);
  if (!options?.force && inflight) {
    return inflight;
  }

  const slug = options?.includeRecipient?.trim();
  const request = api
    .get<PublicContactRecipientsResponse>('/public/contact-recipients', {
      params: slug ? { includeRecipient: slug } : undefined,
    })
    .then((response) => {
      const rows = Array.isArray(response.data) ? response.data : [];
      cachedRecipientsByInclude.set(key, rows);
      return rows;
    })
    .finally(() => {
      inflightByInclude.delete(key);
    });

  inflightByInclude.set(key, request);
  return request;
}

export function invalidatePublicContactRecipientsCache(): void {
  cachedRecipientsByInclude.clear();
  inflightByInclude.clear();
  cachedAdminRecipients = null;
  adminInflight = null;
}

type UsePublicContactRecipientsOptions = {
  includeRecipient?: string | null;
  enabled?: boolean;
};

export function usePublicContactRecipients(options?: UsePublicContactRecipientsOptions) {
  const includeRecipient = options?.includeRecipient ?? null;
  const enabled = options?.enabled ?? true;
  const key = cacheKey(includeRecipient);
  const [recipients, setRecipients] = useState<PublicContactRecipientOption[]>(
    () => (enabled ? (cachedRecipientsByInclude.get(key) ?? []) : []),
  );
  const [loading, setLoading] = useState(enabled && !cachedRecipientsByInclude.has(key));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (force = true) => {
      if (!enabled) return;
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchPublicContactRecipients({ force, includeRecipient });
        setRecipients(rows);
      } catch {
        setError('Failed to load contact options');
        setRecipients([]);
      } finally {
        setLoading(false);
      }
    },
    [enabled, includeRecipient],
  );

  useEffect(() => {
    if (!enabled) {
      setRecipients([]);
      setLoading(false);
      setError(null);
      return;
    }
    const cached = cachedRecipientsByInclude.get(key);
    if (cached) {
      setRecipients(cached);
      setLoading(false);
      return;
    }
    void reload(false);
  }, [enabled, key, reload]);

  return { recipients, loading, error, reload };
}

let cachedAdminRecipients: AdminContactRecipientOption[] | null = null;
let adminInflight: Promise<AdminContactRecipientOption[]> | null = null;

export async function fetchAdminContactRecipients(options?: {
  force?: boolean;
}): Promise<AdminContactRecipientOption[]> {
  if (!options?.force && cachedAdminRecipients) {
    return cachedAdminRecipients;
  }
  if (!options?.force && adminInflight) {
    return adminInflight;
  }

  adminInflight = api
    .get<AdminContactRecipientOption[]>('/content/contact-recipients')
    .then((response) => {
      const rows = Array.isArray(response.data) ? response.data : [];
      cachedAdminRecipients = rows;
      return rows;
    })
    .finally(() => {
      adminInflight = null;
    });

  return adminInflight;
}

type UseAdminContactRecipientsOptions = {
  enabled?: boolean;
};

export function useAdminContactRecipients(options?: UseAdminContactRecipientsOptions) {
  const enabled = options?.enabled ?? true;
  const [recipients, setRecipients] = useState<AdminContactRecipientOption[]>(
    () => (enabled ? (cachedAdminRecipients ?? []) : []),
  );
  const [loading, setLoading] = useState(enabled && cachedAdminRecipients == null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (force = true) => {
      if (!enabled) return;
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchAdminContactRecipients({ force });
        setRecipients(rows);
      } catch {
        setError('Failed to load contact options');
        setRecipients([]);
      } finally {
        setLoading(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setRecipients([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (cachedAdminRecipients) {
      setRecipients(cachedAdminRecipients);
      setLoading(false);
      return;
    }
    void reload(false);
  }, [enabled, reload]);

  return { recipients, loading, error, reload };
}
