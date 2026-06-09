import { useEffect, useMemo, useState } from 'react';
import { post } from '../../api/client';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { useAlert } from '../../contexts/AlertContext';
import InlineStateMessage from '../../components/InlineStateMessage';
import {
  memberEmailLookup,
  memberNameLookup,
  memberNameMatchKeyFromFullName,
  parseMemberExperienceBaselineTsv,
  resolveExperienceBaselineMemberMatch,
  summarizeExperienceBaselineImportCoverage,
  type ParsedExperienceBaselineRow,
} from '../../utils/memberExperienceBaselineImport';
import type { MemberSummary as Member } from '../../../../backend/src/types.ts';

type ImportResult = {
  email: string;
  name?: string;
  status: 'updated' | 'unchanged' | 'not_found' | 'ambiguous_email' | 'ambiguous_name' | 'invalid';
  memberId?: number;
  memberName?: string;
  message?: string;
};

type Props = {
  isOpen: boolean;
  members: Member[];
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

type PreviewRow = ParsedExperienceBaselineRow & {
  matchedMemberId?: number;
  matchedMemberName?: string;
  matchStatus?: 'matched' | 'not_found' | 'ambiguous_email' | 'ambiguous_name';
  previewIssue?: string;
};

function statusLabel(status: ImportResult['status']): string {
  switch (status) {
    case 'updated':
      return 'Updated';
    case 'unchanged':
      return 'Unchanged';
    case 'not_found':
      return 'Not found';
    case 'ambiguous_email':
      return 'Ambiguous email';
    case 'ambiguous_name':
      return 'Ambiguous name';
    case 'invalid':
      return 'Invalid';
    default:
      return status;
  }
}

export default function AdminMembersExperienceBaselinesImportModal({
  isOpen,
  members,
  onClose,
  onImported,
}: Props) {
  const { showAlert } = useAlert();
  const [bulkText, setBulkText] = useState('');
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const [bulkStep, setBulkStep] = useState<'input' | 'confirm' | 'results'>('input');
  const [submitting, setSubmitting] = useState(false);

  const membersByEmail = useMemo(() => memberEmailLookup(members), [members]);
  const membersByName = useMemo(() => memberNameLookup(members), [members]);

  useEffect(() => {
    if (!isOpen) {
      setBulkText('');
      setPreviewRows([]);
      setImportResults(null);
      setBulkStep('input');
    }
  }, [isOpen]);

  const validPreviewRows = previewRows.filter((row) => !row.parseError && !row.previewIssue);

  const importCoverage = useMemo(() => {
    if (!importResults) return null;
    return summarizeExperienceBaselineImportCoverage(previewRows, members);
  }, [importResults, previewRows, members]);

  const handleParseBulk = () => {
    const parsed = parseMemberExperienceBaselineTsv(bulkText);
    if (parsed.fatalError) {
      showAlert(parsed.fatalError, 'warning');
      return;
    }

    const seenEmails = new Set<string>();
    const seenNames = new Set<string>();
    const rows: PreviewRow[] = parsed.rows.map((row) => {
      const issues: string[] = [];
      if (row.parseError) issues.push(row.parseError);

      if (!row.parseError) {
        const emailKey = row.email.trim().toLowerCase();
        if (emailKey) {
          if (seenEmails.has(emailKey)) {
            issues.push('Duplicate email in pasted data.');
          } else {
            seenEmails.add(emailKey);
          }
        } else {
          const nameKey = memberNameMatchKeyFromFullName(row.name);
          if (nameKey) {
            if (seenNames.has(nameKey)) {
              issues.push('Duplicate name in pasted data.');
            } else {
              seenNames.add(nameKey);
            }
          }
        }

        const matchResult = resolveExperienceBaselineMemberMatch(row, membersByEmail, membersByName);
        if (matchResult.issue) issues.push(matchResult.issue);

        return {
          ...row,
          matchedMemberId: matchResult.member?.id,
          matchedMemberName: matchResult.member?.name,
          matchStatus: matchResult.status,
          previewIssue: issues.length > 0 ? issues.join(' ') : undefined,
        };
      }

      return {
        ...row,
        previewIssue: issues.length > 0 ? issues.join(' ') : undefined,
      };
    });

    if (rows.length === 0) {
      showAlert('No rows found to import.', 'warning');
      return;
    }

    setPreviewRows(rows);
    setBulkStep('confirm');
  };

  const handleBulkSubmit = async () => {
    if (validPreviewRows.length === 0) {
      showAlert('Fix the rows with errors before importing.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const response = await post('/members/bulk-experience-baselines', {
        rows: validPreviewRows.map((row) => ({
          email: row.email.trim() || undefined,
          name: row.name.trim() || undefined,
          baselineOtherClubExperienceYears: row.baselineOtherClubExperienceYears,
          baselineClubExperienceYears: row.baselineClubExperienceYears,
        })),
      });
      const results = (response as { results: ImportResult[] }).results ?? [];
      setImportResults(results);
      setBulkStep('results');
      await onImported();

      const updatedCount = results.filter((r) => r.status === 'updated').length;
      const failedCount = results.filter(
        (r) =>
          r.status === 'not_found' ||
          r.status === 'invalid' ||
          r.status === 'ambiguous_email' ||
          r.status === 'ambiguous_name',
      ).length;
      if (updatedCount > 0) {
        showAlert(`Updated baseline experience for ${updatedCount} member${updatedCount === 1 ? '' : 's'}.`, 'success');
      } else if (failedCount > 0) {
        showAlert('Import finished with errors. Review the results below.', 'warning');
      } else {
        showAlert('No changes were needed; all rows already matched existing baselines.', 'info');
      }
    } catch (error) {
      console.error('Failed to import experience baselines:', error);
      showAlert('Failed to import experience baselines', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const warningCount = previewRows.filter((row) => row.totalMismatchWarning).length;
  const errorCount = previewRows.filter((row) => row.parseError || row.previewIssue).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import experience baselines" size="xl">
      <div className="flex min-h-0 flex-col space-y-4">
        {bulkStep === 'input' ? (
          <>
            <div className="flex-shrink-0">
              <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                Paste spreadsheet data with a header row. Members are matched by email when present, otherwise by
                stored first and last name.
              </p>
              <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                Expected columns: <strong>name</strong>, <strong>email</strong> (at least one per row),{' '}
                <strong>other-years</strong>, <strong>our-years</strong>. <strong>total-years</strong> is optional and
                used only for a sanity check.
              </p>
              <textarea
                className="app-input h-64 font-mono text-sm"
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder={
                  'name\temail\tother-years\tour-years\ttotal-years\nTrevor Gau\tcurl@tgau.me\t0\t10\t10'
                }
              />
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleParseBulk}>Preview</Button>
            </div>
          </>
        ) : null}

        {bulkStep === 'confirm' ? (
          <>
            <div className="min-h-0 flex-1 flex flex-col">
              <p className="mb-2 flex-shrink-0 text-sm text-gray-600 dark:text-gray-400">
                {validPreviewRows.length} of {previewRows.length} rows are ready to import.
                {errorCount > 0 ? ` ${errorCount} row${errorCount === 1 ? '' : 's'} will be skipped.` : ''}
                {warningCount > 0 ? ` ${warningCount} row${warningCount === 1 ? '' : 's'} have total-year warnings.` : ''}
              </p>
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="app-table">
                  <thead className="app-table-head sticky top-0 z-10">
                    <tr>
                      <th className="app-table-th">Line</th>
                      <th className="app-table-th">Name</th>
                      <th className="app-table-th">Email</th>
                      <th className="app-table-th">Other years</th>
                      <th className="app-table-th">Our years</th>
                      <th className="app-table-th">Matched member</th>
                      <th className="app-table-th">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {previewRows.map((row) => (
                      <tr key={row.lineNumber}>
                        <td className="app-table-td whitespace-nowrap">{row.lineNumber}</td>
                        <td className="app-table-td whitespace-nowrap">{row.name || '—'}</td>
                        <td className="app-table-td break-words">{row.email}</td>
                        <td className="app-table-td whitespace-nowrap">{row.baselineOtherClubExperienceYears}</td>
                        <td className="app-table-td whitespace-nowrap">{row.baselineClubExperienceYears}</td>
                        <td className="app-table-td whitespace-nowrap">{row.matchedMemberName || '—'}</td>
                        <td className="app-table-td text-sm">
                          {row.parseError || row.previewIssue ? (
                            <span className="text-red-600 dark:text-red-400">
                              {row.parseError || row.previewIssue}
                            </span>
                          ) : row.totalMismatchWarning ? (
                            <span className="text-amber-700 dark:text-amber-300">{row.totalMismatchWarning}</span>
                          ) : (
                            <span className="text-green-700 dark:text-green-300">Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end space-x-3 border-t pt-4 dark:border-gray-700">
              <Button variant="secondary" onClick={() => setBulkStep('input')}>
                Back
              </Button>
              <Button onClick={handleBulkSubmit} disabled={submitting || validPreviewRows.length === 0}>
                {submitting
                  ? 'Importing...'
                  : `Import ${validPreviewRows.length} baseline${validPreviewRows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        ) : null}

        {bulkStep === 'results' && importResults && importCoverage ? (
          <>
            <p className="flex-shrink-0 text-sm text-gray-600 dark:text-gray-400">
              {importResults.filter((r) => r.status === 'updated').length} updated,{' '}
              {importResults.filter((r) => r.status === 'unchanged').length} unchanged,{' '}
              {importCoverage.notFoundRows.length} import row
              {importCoverage.notFoundRows.length === 1 ? '' : 's'} not found,{' '}
              {importCoverage.membersNotInImport.length} member
              {importCoverage.membersNotInImport.length === 1 ? '' : 's'} not in import.
            </p>

            <div className="min-h-0 flex-1 space-y-6 overflow-auto">
              <section>
                <h3 className="app-section-title mb-2">Import results</h3>
                {importResults.length === 0 ? (
                  <InlineStateMessage tone="neutral" title="No rows were imported." />
                ) : (
                  <table className="app-table">
                    <thead className="app-table-head sticky top-0 z-10">
                      <tr>
                        <th className="app-table-th">Name</th>
                        <th className="app-table-th">Email</th>
                        <th className="app-table-th">Member</th>
                        <th className="app-table-th">Result</th>
                        <th className="app-table-th">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {importResults.map((result, index) => (
                        <tr key={`${result.email ?? result.name ?? 'row'}-${index}`}>
                          <td className="app-table-td whitespace-nowrap">{result.name || '—'}</td>
                          <td className="app-table-td break-words">{result.email || '—'}</td>
                          <td className="app-table-td whitespace-nowrap">{result.memberName || '—'}</td>
                          <td className="app-table-td whitespace-nowrap">{statusLabel(result.status)}</td>
                          <td className="app-table-td text-sm text-gray-600 dark:text-gray-400">
                            {result.message || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section>
                <h3 className="app-section-title mb-2">Not found in member database</h3>
                <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                  Import rows that did not match any member.
                </p>
                {importCoverage.notFoundRows.length === 0 ? (
                  <InlineStateMessage tone="neutral" title="Every import row matched a member." />
                ) : (
                  <table className="app-table">
                    <thead className="app-table-head sticky top-0 z-10">
                      <tr>
                        <th className="app-table-th">Line</th>
                        <th className="app-table-th">Name</th>
                        <th className="app-table-th">Email</th>
                        <th className="app-table-th">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {importCoverage.notFoundRows.map((row) => (
                        <tr key={row.lineNumber}>
                          <td className="app-table-td whitespace-nowrap">{row.lineNumber}</td>
                          <td className="app-table-td whitespace-nowrap">{row.name || '—'}</td>
                          <td className="app-table-td break-words">{row.email || '—'}</td>
                          <td className="app-table-td text-sm text-gray-600 dark:text-gray-400">
                            {row.previewIssue || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section>
                <h3 className="app-section-title mb-2">Members not in import</h3>
                <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                  Members in the app with no matching row in the pasted import.
                </p>
                {importCoverage.membersNotInImport.length === 0 ? (
                  <InlineStateMessage tone="neutral" title="Every member appeared in the import." />
                ) : (
                  <table className="app-table">
                    <thead className="app-table-head sticky top-0 z-10">
                      <tr>
                        <th className="app-table-th">Name</th>
                        <th className="app-table-th">Email</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {importCoverage.membersNotInImport.map((member) => (
                        <tr key={member.id}>
                          <td className="app-table-td whitespace-nowrap">{member.name}</td>
                          <td className="app-table-td break-words">{member.email || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
            <div className="flex justify-end border-t pt-4 dark:border-gray-700">
              <Button onClick={onClose}>Close</Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
