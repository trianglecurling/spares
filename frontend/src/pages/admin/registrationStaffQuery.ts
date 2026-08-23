export type RegistrationStaffQueryRule = {
  field: string;
  operator: string;
  value?: unknown;
};

export type RegistrationStaffQuery = {
  match: 'all' | 'any';
  rules: RegistrationStaffQueryRule[];
};

export function emptyRegistrationStaffQuery(): RegistrationStaffQuery {
  return { match: 'all', rules: [] };
}

export function registrationStaffQuery(
  rules: RegistrationStaffQueryRule[],
  match: 'all' | 'any' = 'all',
): RegistrationStaffQuery {
  return { match, rules };
}

export function registrationStaffRule(
  field: string,
  operator: string,
  value?: unknown,
): RegistrationStaffQueryRule {
  return { field, operator, value };
}

export function serializeRegistrationStaffQuery(query: RegistrationStaffQuery | null | undefined): string {
  if (!query || query.rules.length === 0) return '';
  return JSON.stringify({
    match: query.match === 'any' ? 'any' : 'all',
    rules: query.rules,
  });
}

export function parseRegistrationStaffQueryParam(raw: string | null | undefined): RegistrationStaffQuery {
  if (!raw) return emptyRegistrationStaffQuery();
  try {
    const parsed = JSON.parse(raw) as { match?: unknown; rules?: unknown };
    const match = parsed.match === 'any' ? 'any' : 'all';
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.flatMap((item) => {
          if (typeof item !== 'object' || item == null || Array.isArray(item)) return [];
          const rule = item as { field?: unknown; operator?: unknown; value?: unknown };
          if (typeof rule.field !== 'string' || typeof rule.operator !== 'string') return [];
          return [{ field: rule.field, operator: rule.operator, value: rule.value }];
        })
      : [];
    return { match, rules };
  } catch {
    return emptyRegistrationStaffQuery();
  }
}

export function registrationListSearch(input: {
  sessionId: number;
  query?: RegistrationStaffQuery | null;
}): string {
  const params = new URLSearchParams();
  params.set('sessionId', String(input.sessionId));
  const encoded = serializeRegistrationStaffQuery(input.query);
  if (encoded) params.set('q', encoded);
  return params.toString();
}

export function registrationListHref(sessionId: number, query?: RegistrationStaffQuery | null): string {
  return `/admin/registrations/list?${registrationListSearch({ sessionId, query })}`;
}
