import { useId, useMemo, useState } from 'react';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { post } from '../../api/client';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import Modal from '../../components/Modal';
import { useAlert } from '../../contexts/AlertContext';
import AppStateCard from '../../components/AppStateCard';
import InlineStateMessage from '../../components/InlineStateMessage';
import type { paths } from '../../api/generated/types';
import { HiEye } from 'react-icons/hi2';

type BulkResponse = paths['/waivers/admin/bulk-lookup']['post']['responses']['200']['content']['application/json'];
type BulkRow = BulkResponse['rows'][number];
type Candidate = BulkRow['candidates'][number];

const NONE_VALUE = '__none__';

/** Most recent July 1 on or before today (local calendar). */
function mostRecentJulyFirstISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const thisJulyFirst = new Date(y, 6, 1);
  const target = now < thisJulyFirst ? new Date(y - 1, 6, 1) : thisJulyFirst;
  const yy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatUsDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function splitFullName(full: string): { firstName: string; lastName: string } {
  const t = full.trim();
  if (!t) return { firstName: '', lastName: '' };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Minor waivers use `allNames` as "Parent First Last,Minor First Last" (last segment = participant to match).
 */
function parseAllNamesFromDetail(detail: unknown): { participant: string; guardian: string | null } {
  if (!detail || typeof detail !== 'object') return { participant: '', guardian: null };
  const raw = (detail as Record<string, unknown>).allNames;
  if (typeof raw !== 'string' || !raw.trim()) return { participant: '', guardian: null };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { participant: '', guardian: null };
  return {
    participant: parts[parts.length - 1]!,
    guardian: parts.length > 1 ? parts[0]! : null,
  };
}

function minorAgeFromAdditionals(detail: unknown): number | null {
  if (!detail || typeof detail !== 'object') return null;
  const add = (detail as Record<string, unknown>).Additionals;
  if (!Array.isArray(add)) return null;
  for (const item of add) {
    if (!item || typeof item !== 'object') continue;
    const a = item as { type?: string; value?: unknown };
    if (a.type !== 'number') continue;
    const n = typeof a.value === 'number' ? a.value : Number(a.value);
    if (Number.isInteger(n) && n >= 1 && n <= 17) return n;
  }
  return null;
}

/** Exactly 10 digits and no ASCII letters (e.g. parent phone in shortAns). */
function looksLikeUsPhone10Digits(raw: string): boolean {
  if (/[a-zA-Z]/.test(raw)) return false;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10;
}

function parentPhoneFromAdditionals(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const add = (detail as Record<string, unknown>).Additionals;
  if (!Array.isArray(add)) return null;
  for (const item of add) {
    if (!item || typeof item !== 'object') continue;
    const o = item as { type?: string; ans?: unknown; value?: unknown };
    const raw =
      typeof o.ans === 'string'
        ? o.ans.trim()
        : typeof o.value === 'string'
          ? o.value.trim()
          : '';
    if (!raw || !looksLikeUsPhone10Digits(raw)) continue;
    return raw;
  }
  return null;
}

function isMinorWaiverDetail(detail: unknown): boolean {
  if (!detail || typeof detail !== 'object') return false;
  if (minorAgeFromAdditionals(detail) !== null) return true;
  if (parseAllNamesFromDetail(detail).guardian) return true;
  if ((detail as Record<string, unknown>).showMinorTemplate === true) return true;
  return false;
}

function buildParticipantDisplayLabel(
  participant: string,
  guardian: string | null,
  age: number | null
): string {
  const p = participant.trim();
  if (!p) return '';
  const bits: string[] = [];
  if (age !== null) bits.push(`age: ${age}`);
  if (guardian) bits.push(`parent/guardian: ${guardian}`);
  if (bits.length === 0) return p;
  return `${p} (${bits.join(', ')})`;
}

type ParsedCleverDetail = {
  signedIso: string | null;
  signedUs: string;
  firstName: string;
  lastName: string;
  email: string;
  displayName: string;
  templateHeader: string;
  minorAge: number | null;
  parentPhone: string | null;
  signatureSrc: string | null;
};

function parseCleverWaiverDetail(detail: unknown): ParsedCleverDetail {
  const empty: ParsedCleverDetail = {
    signedIso: null,
    signedUs: '',
    firstName: '',
    lastName: '',
    email: '',
    displayName: '',
    templateHeader: '',
    minorAge: null,
    parentPhone: null,
    signatureSrc: null,
  };
  if (!detail || typeof detail !== 'object') return empty;

  const o = detail as Record<string, unknown>;
  const signedIso = typeof o.signedDate === 'string' ? o.signedDate : null;
  let email = typeof o.email === 'string' ? o.email : '';

  const headerObj = o.Header;
  let templateHeader = '';
  if (headerObj && typeof headerObj === 'object' && headerObj !== null && 'header' in headerObj) {
    const h = (headerObj as { header?: unknown }).header;
    templateHeader = typeof h === 'string' ? h : '';
  }

  const minorAge = minorAgeFromAdditionals(detail);
  const { participant: pFromAll, guardian } = parseAllNamesFromDetail(detail);
  let participant = pFromAll.trim();

  let signatureSrc: string | null = null;
  const additionals = Array.isArray(o.Additionals) ? o.Additionals : [];
  for (const item of additionals) {
    if (!item || typeof item !== 'object') continue;
    const a = item as {
      type?: string;
      value?: string;
      dataUrl?: { dataUrl?: string } | string;
    };
    if (a.type === 'name' && typeof a.value === 'string' && a.value.trim() && !participant) {
      participant = a.value.trim();
    }
    if (a.type === 'email' && typeof a.value === 'string' && a.value.trim() && !email) {
      email = a.value.trim();
    }
    if (a.type === 'signature') {
      if (a.dataUrl && typeof a.dataUrl === 'object' && a.dataUrl !== null && 'dataUrl' in a.dataUrl) {
        const inner = (a.dataUrl as { dataUrl?: unknown }).dataUrl;
        if (typeof inner === 'string') signatureSrc = inner;
      } else if (typeof a.dataUrl === 'string') {
        signatureSrc = a.dataUrl;
      }
    }
  }

  if (!participant && typeof o.name === 'string' && o.name.trim()) {
    participant = o.name.trim();
  }

  const displayName = buildParticipantDisplayLabel(participant, guardian, minorAge);
  const { firstName, lastName } = splitFullName(participant);
  const parentPhone = parentPhoneFromAdditionals(detail);

  return {
    signedIso,
    signedUs: formatUsDate(signedIso),
    firstName,
    lastName,
    email,
    displayName,
    templateHeader,
    minorAge,
    parentPhone,
    signatureSrc,
  };
}

function formatMinorLine(value: boolean | null): string {
  if (value === true) return 'Minor waiver';
  if (value === false) return 'Adult waiver';
  return 'Unknown';
}

function resolveSummaryRow(row: BulkRow, selection: string | undefined): {
  dateSigned: string;
  firstName: string;
  lastName: string;
  email: string;
  minorAge: number | null;
  parentPhone: string | null;
  isMinorRow: boolean;
} {
  const pending = selection === undefined;
  const none = selection === NONE_VALUE;

  if (pending || none) {
    return {
      dateSigned: '',
      firstName: row.input.firstName ?? '',
      lastName: row.input.lastName ?? '',
      email: row.input.email ?? '',
      minorAge: null,
      parentPhone: null,
      isMinorRow: false,
    };
  }

  const c = row.candidates.find((x) => x.waiverId === selection);
  const isMinorRow = isMinorWaiverDetail(c?.detail);
  const parsed = parseCleverWaiverDetail(c?.detail);
  const minorAge = parsed.minorAge ?? c?.minorAge ?? null;
  const parentPhone = isMinorRow ? parsed.parentPhone : null;
  return {
    dateSigned: parsed.signedUs || formatUsDate(c?.signedDate ?? null) || '',
    firstName: parsed.firstName || row.input.firstName || '',
    lastName: parsed.lastName || row.input.lastName || '',
    email: parsed.email || row.input.email || '',
    minorAge,
    parentPhone,
    isMinorRow,
  };
}

function tsvCell(value: string): string {
  return value.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');
}

function summaryTableToTsv(
  rows: Array<{
    dateSigned: string;
    firstName: string;
    lastName: string;
    email: string;
    minorAge: number | null;
    parentPhone: string | null;
  }>,
  includeMinorColumns: boolean
): string {
  const baseHeader = ['Date signed', 'First name', 'Last name', 'Email'];
  const header = includeMinorColumns
    ? [...baseHeader, 'Minor age', 'Parent phone']
    : baseHeader;
  const lines = rows.map((r) => {
    const cells = [
      tsvCell(r.dateSigned),
      tsvCell(r.firstName),
      tsvCell(r.lastName),
      tsvCell(r.email),
    ];
    if (includeMinorColumns) {
      cells.push(r.minorAge !== null ? String(r.minorAge) : '');
      cells.push(r.parentPhone ? tsvCell(r.parentPhone) : '');
    }
    return cells.join('\t');
  });
  return [header.join('\t'), ...lines].join('\n');
}

export default function AdminWaivers() {
  const { showAlert } = useAlert();
  const listId = useId();
  const dateId = useId();
  const summaryCaptionId = useId();

  const [rawList, setRawList] = useState('');
  const [validFrom, setValidFrom] = useState(mostRecentJulyFirstISO);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BulkResponse | null>(null);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [viewTarget, setViewTarget] = useState<{ lineIndex: number; candidate: Candidate } | null>(null);

  const viewParsed = viewTarget ? parseCleverWaiverDetail(viewTarget.candidate.detail) : null;

  const summaryRows = useMemo(() => {
    if (!result?.rows.length) return [];
    return [...result.rows]
      .sort((a, b) => a.lineIndex - b.lineIndex)
      .map((row) => ({
        lineIndex: row.lineIndex,
        ...resolveSummaryRow(row, selections[row.lineIndex]),
      }));
  }, [result, selections]);

  const hasMinorColumns = useMemo(() => summaryRows.some((r) => r.isMinorRow), [summaryRows]);

  async function runLookup() {
    setLoading(true);
    setResult(null);
    setSelections({});
    setViewTarget(null);
    try {
      const data = await post('/waivers/admin/bulk-lookup', {
        rawList,
        validFrom,
      });
      setResult(data);
      const next: Record<number, string> = {};
      for (const row of data.rows) {
        if (row.candidates.length === 1) {
          next[row.lineIndex] = row.candidates[0].waiverId;
        } else if (row.candidates.length === 0) {
          next[row.lineIndex] = NONE_VALUE;
        }
      }
      setSelections(next);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'error' in e ? String((e as { error: unknown }).error) : 'Lookup failed';
      showAlert(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  function selectWaiver(lineIndex: number, waiverId: string) {
    setSelections((prev) => ({ ...prev, [lineIndex]: waiverId }));
    setViewTarget(null);
  }

  async function copySummaryToClipboard() {
    if (summaryRows.length === 0) {
      showAlert('There is no summary to copy yet.', 'warning');
      return;
    }
    try {
      const body = summaryRows.map(({ dateSigned, firstName, lastName, email, minorAge, parentPhone }) => ({
        dateSigned,
        firstName,
        lastName,
        email,
        minorAge,
        parentPhone,
      }));
      await navigator.clipboard.writeText(summaryTableToTsv(body, hasMinorColumns));
      showAlert('Summary copied as TSV.', 'success');
    } catch {
      showAlert('Could not copy to the clipboard.', 'error');
    }
  }

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Manage waivers"
          description="Look up signed CleverWaiver waivers from a pasted list."
        />

        <div className="app-card p-6 space-y-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Paste one person per line: either <strong>first last</strong> or <strong>last, first</strong>. Each line is
            looked up in CleverWaiver by <strong>last name</strong> (and matched to the first name when possible). Only
            waivers signed on or after the valid-from date (in the club time zone) are included. Results come from the
            CleverWaiver API (
            <a
              href="https://app.cleverwaiver.com/developer/document"
              className="text-primary-teal hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              documentation
            </a>
            ).
          </p>

          <FormSection title="Lookup">
            <FormField label="Valid from (inclusive)" htmlFor={dateId}>
              <input
                id={dateId}
                type="date"
                className="app-input w-full max-w-xs"
                value={validFrom}
                onChange={(ev) => setValidFrom(ev.target.value)}
              />
            </FormField>
            <FormField label="List" htmlFor={listId}>
              <textarea
                id={listId}
                className="app-input w-full min-h-[200px] font-mono text-sm"
                value={rawList}
                onChange={(ev) => setRawList(ev.target.value)}
                placeholder={'Jamie Smith\nJones, Taylor\nStanton, Bobby'}
              />
            </FormField>
            <div className="flex gap-3 items-center">
              <Button type="button" onClick={() => void runLookup()} disabled={loading || !rawList.trim()}>
                {loading ? 'Looking up…' : 'Look up waivers'}
              </Button>
              {loading ? <InlineStateMessage title="Contacting CleverWaiver…" tone="neutral" /> : null}
            </div>
          </FormSection>
        </div>

        {result ? (
          <div className="app-card p-6 mt-6 space-y-6">
            <h2 className="app-section-title">Results</h2>

            {result.rows.length === 0 ? (
              <AppStateCard title="No rows" description="Paste at least one non-empty line." />
            ) : (
              <>
                <ul className="space-y-8">
                  {result.rows.map((row) => {
                    const key = row.lineIndex;
                    const selected = selections[key];
                    const signedLabel = (c: Candidate) =>
                      formatUsDate(c.signedDate) || formatUsDate(parseCleverWaiverDetail(c.detail).signedIso) || '—';

                    return (
                      <li
                        key={key}
                        className="border-t border-gray-200 dark:border-gray-700 pt-6 first:border-t-0 first:pt-0"
                      >
                        <div className="flex flex-col gap-4">
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              Line {key + 1}: {row.input.rawLine || '(empty)'}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Parsed:{' '}
                              {[row.input.firstName, row.input.lastName].filter(Boolean).join(' ') || '—'}
                              {' · '}
                              Search: {row.searchMode.replace('_', ' ')}
                            </div>
                            {row.error ? (
                              <div className="app-alert-danger mt-2 text-sm" role="alert">
                                {row.error}
                              </div>
                            ) : null}
                          </div>

                          {row.candidates.length > 0 ? (
                            <div className="space-y-3">
                              <p className="app-label">Matching waivers</p>
                              <ul className="space-y-2">
                                {row.candidates.map((c) => {
                                  const isChosen = selected === c.waiverId;
                                  return (
                                    <li
                                      key={c.waiverId}
                                      className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                                        isChosen
                                          ? 'border-primary-teal bg-primary-teal/5 dark:bg-primary-teal/10'
                                          : 'border-gray-200 dark:border-gray-600'
                                      }`}
                                    >
                                      <div className="flex-1 min-w-[200px]">
                                        <div className="font-medium text-gray-900 dark:text-gray-100">
                                          {c.displayName || 'Name not available'}
                                        </div>
                                        <div className="text-gray-600 dark:text-gray-400 text-xs mt-0.5">
                                          Signed {signedLabel(c)} · {formatMinorLine(c.isMinor)}
                                          {c.email ? ` · ${c.email}` : ''}
                                        </div>
                                        {c.templateHeader ? (
                                          <div className="text-gray-500 text-xs mt-0.5">{c.templateHeader}</div>
                                        ) : null}
                                        {c.fetchError ? (
                                          <div className="text-amber-700 dark:text-amber-300 text-xs mt-1">
                                            {c.fetchError}
                                          </div>
                                        ) : null}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <button
                                          type="button"
                                          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-teal/40"
                                          aria-label={`View waiver details for ${c.displayName || c.waiverId}`}
                                          onClick={() => setViewTarget({ lineIndex: key, candidate: c })}
                                        >
                                          <HiEye className="w-5 h-5" aria-hidden />
                                        </button>
                                        <Button
                                          type="button"
                                          variant={isChosen ? 'primary' : 'secondary'}
                                          className="!px-3 !py-1.5 text-xs"
                                          onClick={() => selectWaiver(key, c.waiverId)}
                                        >
                                          Use this waiver
                                        </Button>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                              <div className="pt-1">
                                <Button
                                  type="button"
                                  variant={selected === NONE_VALUE ? 'primary' : 'secondary'}
                                  className="!px-3 !py-1.5 text-xs"
                                  onClick={() => selectWaiver(key, NONE_VALUE)}
                                >
                                  None of these waivers
                                </Button>
                              </div>
                            </div>
                          ) : row.error ? null : (
                            <InlineStateMessage title="No waivers matched this search." tone="neutral" />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h3 id={summaryCaptionId} className="app-section-title text-base">
                      Summary
                    </h3>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-3 !py-1.5 text-xs shrink-0"
                      onClick={() => void copySummaryToClipboard()}
                    >
                      Copy summary
                    </Button>
                  </div>
                  <div className="app-table-shell overflow-x-auto">
                    <table className="app-table" aria-labelledby={summaryCaptionId}>
                      <thead className="app-table-head">
                        <tr>
                          <th className="app-table-th">Date signed</th>
                          <th className="app-table-th">First name</th>
                          <th className="app-table-th">Last name</th>
                          <th className="app-table-th">Email</th>
                          {hasMinorColumns ? (
                            <>
                              <th className="app-table-th">Minor age</th>
                              <th className="app-table-th">Parent phone</th>
                            </>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {summaryRows.map((r) => (
                          <tr key={r.lineIndex}>
                            <td className="app-table-td whitespace-nowrap">{r.dateSigned || ''}</td>
                            <td className="app-table-td">{r.firstName}</td>
                            <td className="app-table-td">{r.lastName}</td>
                            <td className="app-table-td">{r.email}</td>
                            {hasMinorColumns ? (
                              <>
                                <td className="app-table-td whitespace-nowrap">
                                  {r.minorAge !== null ? r.minorAge : ''}
                                </td>
                                <td className="app-table-td whitespace-nowrap">{r.parentPhone ?? ''}</td>
                              </>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        <Modal
          isOpen={viewTarget !== null}
          onClose={() => setViewTarget(null)}
          title="Waiver details"
          size="lg"
          verticalAlign="start"
        >
          {viewTarget && viewParsed ? (
            <div className="space-y-4 text-sm">
              {viewTarget.candidate.templateHeader || viewParsed.templateHeader ? (
                <p>
                  <span className="text-gray-500 dark:text-gray-400">Template: </span>
                  <span className="font-medium">{viewTarget.candidate.templateHeader || viewParsed.templateHeader}</span>
                </p>
              ) : null}
              <p>
                <span className="text-gray-500 dark:text-gray-400">Name: </span>
                <span className="font-medium">{viewParsed.displayName || viewTarget.candidate.displayName || '—'}</span>
              </p>
              <p>
                <span className="text-gray-500 dark:text-gray-400">Email: </span>
                <span className="font-medium">{viewParsed.email || viewTarget.candidate.email || '—'}</span>
              </p>
              <p>
                <span className="text-gray-500 dark:text-gray-400">Signed: </span>
                <span className="font-medium">
                  {viewParsed.signedUs ||
                    formatUsDate(viewTarget.candidate.signedDate) ||
                    '—'}
                </span>
              </p>
              {isMinorWaiverDetail(viewTarget.candidate.detail) && viewParsed.parentPhone ? (
                <p>
                  <span className="text-gray-500 dark:text-gray-400">Parent phone: </span>
                  <span className="font-medium">{viewParsed.parentPhone}</span>
                </p>
              ) : null}

              {viewParsed.signatureSrc ? (
                <div>
                  <p className="text-gray-500 dark:text-gray-400 mb-2">Signature</p>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-800/80 p-3 inline-block max-w-full">
                    <img
                      src={viewParsed.signatureSrc}
                      alt="Signed signature from waiver"
                      className="max-h-48 max-w-full object-contain"
                    />
                  </div>
                </div>
              ) : null}

              {viewTarget.candidate.fetchError ? (
                <p className="text-amber-700 dark:text-amber-300 text-xs">{viewTarget.candidate.fetchError}</p>
              ) : null}

              <details className="text-xs">
                <summary className="cursor-pointer text-primary-teal">Raw JSON</summary>
                <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-md overflow-x-auto max-h-56 text-xs">
                  {JSON.stringify(viewTarget.candidate.detail ?? {}, null, 2)}
                </pre>
              </details>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                <Button type="button" onClick={() => selectWaiver(viewTarget.lineIndex, viewTarget.candidate.waiverId)}>
                  Use this waiver
                </Button>
                <Button type="button" variant="secondary" onClick={() => setViewTarget(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>
      </AppPage>
    </Layout>
  );
}
