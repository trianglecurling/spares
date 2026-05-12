import { useEffect, useState } from 'react';
import { post } from '../../api/client';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { useAlert } from '../../contexts/AlertContext';
import { formatPhone } from '../../utils/phone';

interface ParsedMember {
  name: string;
  email: string;
  phone: string;
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

export default function AdminMembersBulkImportModal({ isOpen, onClose, onImported }: Props) {
  const { showAlert } = useAlert();
  const [bulkText, setBulkText] = useState('');
  const [bulkValidThrough, setBulkValidThrough] = useState<string>('');
  const [bulkSpareOnly, setBulkSpareOnly] = useState(false);
  const [bulkSocialMember, setBulkSocialMember] = useState(false);
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [bulkStep, setBulkStep] = useState<'input' | 'confirm'>('input');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setBulkText('');
      setBulkValidThrough('');
      setBulkSpareOnly(false);
      setBulkSocialMember(false);
      setParsedMembers([]);
      setBulkStep('input');
    }
  }, [isOpen]);

  const handleParseBulk = () => {
    if (!bulkText.trim()) {
      showAlert('Please paste some data', 'warning');
      return;
    }

    const lines = bulkText.trim().split('\n');
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    const dataLines = lines.length > 1 ? lines.slice(1) : [];

    if (dataLines.length === 0) {
      showAlert('No data found. Please include a header row and at least one member.', 'warning');
      return;
    }

    const parsed = dataLines
      .map((line) => {
        const parts = line.split(delimiter).map((p) => p.trim());
        const firstName = parts[0] || '';
        const lastName = parts[1] || '';
        const phone = parts[2] || '';
        const email = parts[3] || '';
        return {
          name: `${firstName} ${lastName}`.trim(),
          phone,
          email,
        };
      })
      .filter((m) => m.name);

    if (parsed.length === 0) {
      showAlert('No valid members found in data', 'warning');
      return;
    }

    setParsedMembers(parsed);
    setBulkStep('confirm');
  };

  const handleBulkSubmit = async () => {
    if (bulkSpareOnly && bulkSocialMember) {
      showAlert('Members cannot be both spare-only and social.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await post('/members/bulk', {
        members: parsedMembers,
        validThrough: bulkValidThrough ? bulkValidThrough : null,
        spareOnly: bulkSpareOnly,
        socialMember: bulkSocialMember,
      });
      await onImported();
      onClose();
    } catch (error) {
      console.error('Failed to bulk add members:', error);
      showAlert('Failed to bulk add members', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateDisplay = (dateString?: string | null) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
    return adjustedDate.toLocaleDateString();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Bulk import members" size="xl">
      <div className="flex flex-col h-full min-h-0 space-y-4">
        {bulkStep === 'input' ? (
          <>
            <div className="flex-shrink-0">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                Paste your spreadsheet data here. Must include a header row.
                <br />
                Expected columns: <strong>First Name, Last Name, Phone, Email</strong>
              </p>
              <textarea
                className="app-input h-64 font-mono text-sm"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'First Name\tLast Name\tPhone\tEmail\nJohn\tDoe\t555-0123\tjohn@example.com'}
              />
              <div className="mt-4">
                <label htmlFor="bulkValidThrough" className="app-label">
                  Valid through for all imported members (optional)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    id="bulkValidThrough"
                    value={bulkValidThrough}
                    onChange={(e) => setBulkValidThrough(e.target.value)}
                    className="flex-1 app-input"
                  />
                  <Button type="button" variant="secondary" onClick={() => setBulkValidThrough('')}>
                    Clear
                  </Button>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Leave empty for perpetual access. Admin/server admin users are always valid regardless of this date.
                </p>
              </div>

              <div className="mt-4 flex items-start">
                <input
                  type="checkbox"
                  id="bulkSpareOnly"
                  checked={bulkSpareOnly}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setBulkSpareOnly(v);
                    if (v) setBulkSocialMember(false);
                  }}
                  className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                />
                <label htmlFor="bulkSpareOnly" className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Mark all imported members as spare-only</span>
                  <div className="text-gray-600 dark:text-gray-400">
                    Spare-only members can sign up to spare, but cannot create spare requests.
                  </div>
                </label>
              </div>

              <div className="mt-4 flex items-start">
                <input
                  type="checkbox"
                  id="bulkSocialMember"
                  checked={bulkSocialMember}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setBulkSocialMember(v);
                    if (v) setBulkSpareOnly(false);
                  }}
                  className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                />
                <label htmlFor="bulkSocialMember" className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Mark all imported members as social members</span>
                  <div className="text-gray-600 dark:text-gray-400">
                    No ice privileges: cannot spare, request spares, or join league rosters.
                  </div>
                </label>
              </div>
            </div>
            <div className="flex justify-end space-x-3 flex-shrink-0">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleParseBulk}>Preview</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 min-h-0 flex flex-col">
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
                Found {parsedMembers.length} members. Please review before importing.
              </p>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
                Valid through for all imported members:{' '}
                <span className="font-medium dark:text-gray-200">
                  {bulkValidThrough ? formatDateDisplay(bulkValidThrough) : 'No expiry'}
                </span>
              </p>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
                Membership type for import:{' '}
                <span className="font-medium dark:text-gray-200">
                  {bulkSpareOnly
                    ? 'Spare-only'
                    : bulkSocialMember
                      ? 'Social member'
                      : 'Regular (full ice privileges)'}
                </span>
              </p>
              <div className="flex-1 overflow-auto min-h-0">
                <div className="hidden sm:block">
                  <table className="app-table">
                    <thead className="app-table-head sticky top-0 z-10">
                      <tr>
                        <th className="app-table-th">Name</th>
                        <th className="app-table-th">Email</th>
                        <th className="app-table-th">Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {parsedMembers.map((m, i) => (
                        <tr key={i}>
                          <td className="app-table-td whitespace-nowrap">{m.name}</td>
                          <td className="app-table-td break-words">{m.email}</td>
                          <td className="app-table-td whitespace-nowrap">
                            {m.phone ? formatPhone(m.phone) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sm:hidden space-y-3">
                  {parsedMembers.map((m, i) => (
                    <div
                      key={i}
                      className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-200 dark:border-gray-600"
                    >
                      <div className="font-medium text-sm mb-1 dark:text-gray-100">{m.name}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        <div className="mb-1">
                          <span className="font-medium">Email:</span> {m.email}
                        </div>
                        <div>
                          <span className="font-medium">Phone:</span> {m.phone ? formatPhone(m.phone) : '—'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t dark:border-gray-700 flex-shrink-0">
              <Button
                variant="secondary"
                onClick={() => setBulkStep('input')}
                className="w-full sm:w-auto"
              >
                Back
              </Button>
              <Button
                onClick={handleBulkSubmit}
                disabled={submitting}
                className="w-full sm:w-auto"
              >
                {submitting ? 'Importing...' : `Import ${parsedMembers.length} Members`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
