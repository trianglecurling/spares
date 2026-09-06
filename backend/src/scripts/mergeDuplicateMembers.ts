/** Planned duplicate-member merges identified from prod on 2026-09-04. */
export type KnownMemberMerge = {
  name: string;
  keep: number;
  drop: number[];
  note: string;
};

export const KNOWN_MEMBER_MERGES: KnownMemberMerge[] = [
  {
    name: 'Kara Davidson',
    keep: 587,
    drop: [586],
    note: 'Submitter clone of junior curler; 587 has confirmed junior membership.',
  },
  {
    name: 'Luke Jackson',
    keep: 533,
    drop: [532],
    note: 'Submitter clone; 533 is the curler (awaiting payment).',
  },
  {
    name: 'Luke Laski',
    keep: 537,
    drop: [536],
    note: 'Submitter clone; 537 has confirmed junior membership.',
  },
  {
    name: 'Benjamin Leach',
    keep: 585,
    drop: [584],
    note: 'Empty leftover from an abandoned start; parent Jennifer (305) already submitted for 585.',
  },
  {
    name: 'Ruffin Powell',
    keep: 556,
    drop: [555],
    note: 'Same-name someone-else self-registration; 556 has confirmed regular membership.',
  },
  {
    name: 'Scott Rodriguez',
    keep: 581,
    drop: [580],
    note: 'Submitter clone; 581 is the curler (awaiting placement).',
  },
  {
    name: 'Rosalie Sahli',
    keep: 512,
    drop: [511],
    note: 'Submitter clone; 512 has confirmed membership. 511 also submitted for Theodore (513).',
  },
  {
    name: 'Scott Steffen',
    keep: 518,
    drop: [517],
    note: 'Submitter clone; 518 has confirmed membership.',
  },
  {
    name: 'Kyle Wenninger',
    keep: 563,
    drop: [562],
    note: 'Submitter clone; 563 is the curler (awaiting payment). Parent is Stephan (560).',
  },
  {
    name: 'Karl Lindekugel IV',
    keep: 583,
    drop: [582],
    note: 'Second registration attempt; 583 has confirmed social membership. Son Karl Lindekugel V (474) submitted these registrations.',
  },
  {
    name: 'Craig Wilson',
    keep: 531,
    drop: [530, 525, 524],
    note: 'Two registration attempts. Keep confirmed junior (531). 524/525 are the abandoned awaiting-payment pair.',
  },
  {
    name: 'Elizabeth Karan',
    keep: 569,
    drop: [559],
    note: 'Two self-registrations with different emails. Keep 569 (has a login). Cancel the leftover registration after merge.',
  },
];

/** Logical uniqueness used when the DB has no unique index (avoid two memberships for one season). */
export const LOGICAL_UNIQUE_KEYS: Array<{ table: string; column: string; withColumns: string[] }> = [
  { table: 'season_memberships', column: 'member_id', withColumns: ['season_id'] },
  { table: 'curling_ice_privileges', column: 'member_id', withColumns: ['session_id', 'source_type'] },
];

const SQL_IDENT = /^[a-z_][a-z0-9_]*$/i;

export function assertSqlIdent(value: string): string {
  if (!SQL_IDENT.test(value)) {
    throw new Error(`Refusing unsafe SQL identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

export function quoteIdent(value: string): string {
  return `"${assertSqlIdent(value).replaceAll('"', '')}"`;
}

export function normalizePersonNamePart(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function sameFirstLastName(
  left: { first_name?: string | null; last_name?: string | null },
  right: { first_name?: string | null; last_name?: string | null },
): boolean {
  const leftFirst = normalizePersonNamePart(left.first_name);
  const leftLast = normalizePersonNamePart(left.last_name);
  const rightFirst = normalizePersonNamePart(right.first_name);
  const rightLast = normalizePersonNamePart(right.last_name);
  return Boolean(leftFirst && leftLast && leftFirst === rightFirst && leftLast === rightLast);
}

export function validateKnownMemberMerges(merges: KnownMemberMerge[]): string[] {
  const errors: string[] = [];
  const seen = new Map<number, string>();
  for (const merge of merges) {
    if (!Number.isInteger(merge.keep) || merge.keep <= 0) {
      errors.push(`${merge.name}: keep must be a positive integer`);
    }
    if (merge.drop.length === 0) {
      errors.push(`${merge.name}: drop list is empty`);
    }
    if (new Set(merge.drop).size !== merge.drop.length) {
      errors.push(`${merge.name}: drop list has duplicate ids`);
    }
    if (merge.drop.includes(merge.keep)) {
      errors.push(`${merge.name}: keep id ${merge.keep} also appears in drop`);
    }
    const record = (id: number, role: string) => {
      const previous = seen.get(id);
      if (previous) errors.push(`Member ${id} is used as ${previous} and as ${role}`);
      else seen.set(id, role);
    };
    record(merge.keep, `keep for ${merge.name}`);
    for (const dropId of merge.drop) {
      if (!Number.isInteger(dropId) || dropId <= 0) {
        errors.push(`${merge.name}: drop id ${dropId} is not a positive integer`);
        continue;
      }
      record(dropId, `drop for ${merge.name}`);
    }
  }
  return errors;
}

export type UniqueConflictIndex = {
  table: string;
  column: string;
  otherColumns: string[];
  /** Extra AND clauses applied to both alias `d` and `k`, e.g. `d.status = 'active'`. */
  extraPredicates: string[];
};

export function normalizePgTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value !== 'string') return [];
  const inner = value.replace(/^\{/, '').replace(/\}$/, '');
  if (!inner) return [];
  return inner.split(',').map((item) => item.replaceAll('"', '').trim()).filter(Boolean);
}

export function uniqueConflictFromIndex(input: {
  table: string;
  column: string;
  columns: unknown;
  predicate: string | null;
}): UniqueConflictIndex | null {
  const columns = normalizePgTextArray(input.columns);
  if (!columns.includes(input.column)) return null;
  const extraPredicates: string[] = [];
  if (input.predicate) {
    const normalized = input.predicate.replace(/\s+/g, ' ').trim();
    if (normalized === "(status = 'active'::text)" || normalized === "status = 'active'::text") {
      extraPredicates.push(`${quoteIdent('d')}.${quoteIdent('status')} = 'active'`);
      extraPredicates.push(`${quoteIdent('k')}.${quoteIdent('status')} = 'active'`);
    } else {
      throw new Error(
        `Unsupported partial unique index on ${input.table}(${columns.join(', ')}): ${input.predicate}`,
      );
    }
  }
  return {
    table: assertSqlIdent(input.table),
    column: assertSqlIdent(input.column),
    otherColumns: columns.filter((column) => column !== input.column).map(assertSqlIdent),
    extraPredicates,
  };
}

export function conflictDeleteSql(index: UniqueConflictIndex): string {
  const table = quoteIdent(index.table);
  const column = quoteIdent(index.column);
  const joinPredicates = [
    `d.${column} = $1`,
    `k.${column} = $2`,
    ...index.otherColumns.map((columnName) => {
      const quoted = quoteIdent(columnName);
      return `d.${quoted} IS NOT DISTINCT FROM k.${quoted}`;
    }),
    ...index.extraPredicates,
  ];
  return `DELETE FROM ${table} AS d USING ${table} AS k WHERE ${joinPredicates.join(' AND ')}`;
}

export function remapUpdateSql(table: string, column: string): string {
  return `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = $1 WHERE ${quoteIdent(column)} = $2`;
}

export function remainingFkCountSql(table: string, column: string): string {
  return `SELECT count(*)::int AS n FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)} = $1`;
}

export function attachmentCountsSql(fks: Array<{ table: string; column: string }>): string {
  if (fks.length === 0) {
    return `SELECT '' AS table_name, '' AS column_name, 0::int AS n WHERE false`;
  }
  return fks
    .map(
      (fk) =>
        `SELECT ${literal(fk.table)} AS table_name, ${literal(fk.column)} AS column_name, count(*)::int AS n FROM ${quoteIdent(fk.table)} WHERE ${quoteIdent(fk.column)} = $1`,
    )
    .join('\nUNION ALL\n');
}

function literal(value: string): string {
  return `'${assertSqlIdent(value).replaceAll("'", "''")}'`;
}

export type MergeCliArgs = {
  apply: boolean;
  known: boolean;
  force: boolean;
  keep: number | null;
  drop: number[];
};

export function parseMergeCliArgs(argv: string[]): MergeCliArgs {
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run');
  if (apply && dryRun) {
    throw new Error('Pass either --dry-run or --apply, not both.');
  }
  const keepIndex = argv.indexOf('--keep');
  const keep =
    keepIndex >= 0 && argv[keepIndex + 1] != null ? Number.parseInt(argv[keepIndex + 1], 10) : null;
  const drop: number[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--drop' && argv[i + 1] != null) {
      drop.push(Number.parseInt(argv[i + 1], 10));
    }
  }
  if (keep != null && (!Number.isInteger(keep) || keep <= 0)) {
    throw new Error('--keep must be a positive integer.');
  }
  if (drop.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Each --drop must be a positive integer.');
  }
  return {
    apply,
    known: argv.includes('--known'),
    force: argv.includes('--force'),
    keep,
    drop,
  };
}

export function resolveMergeGroups(args: MergeCliArgs): KnownMemberMerge[] {
  if (args.known && (args.keep != null || args.drop.length > 0)) {
    throw new Error('Use either --known or --keep/--drop, not both.');
  }
  if (args.known) return KNOWN_MEMBER_MERGES;
  if (args.keep == null || args.drop.length === 0) {
    throw new Error('Pass --known, or --keep <id> with one or more --drop <id>.');
  }
  return [
    {
      name: `member ${args.keep}`,
      keep: args.keep,
      drop: args.drop,
      note: 'Ad-hoc merge.',
    },
  ];
}
