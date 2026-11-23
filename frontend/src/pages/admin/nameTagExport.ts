export type NameTagExportRow = {
  nameTagName: string;
  includePronouns: boolean;
  pronouns: string | null;
  quantity: number;
  kind: 'new_member' | 'paid_replacement';
  curlerName: string;
};

export const NAME_TAG_KIND_LABELS: Record<NameTagExportRow['kind'], string> = {
  new_member: 'New member',
  paid_replacement: 'Paid replacement',
};

export function nameTagKindLabel(kind: NameTagExportRow['kind']): string {
  return NAME_TAG_KIND_LABELS[kind];
}

export function formatIncludePronouns(includePronouns: boolean): string {
  return includePronouns ? 'Yes' : 'No';
}

function toTsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

export function buildNameTagTsv(rows: NameTagExportRow[]): string {
  const header = ['Name tag name', 'Include pronouns', 'Pronouns', 'Quantity', 'Type', 'Curler'];
  const body = rows.map((row) =>
    [
      row.nameTagName,
      formatIncludePronouns(row.includePronouns),
      row.includePronouns ? (row.pronouns ?? '') : '',
      row.quantity,
      nameTagKindLabel(row.kind),
      row.curlerName,
    ].map(toTsvCell),
  );
  return [header.join('\t'), ...body.map((row) => row.join('\t'))].join('\n');
}
