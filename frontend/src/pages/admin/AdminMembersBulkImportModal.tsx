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
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [bulkStep, setBulkStep] = useState<'input' | 'confirm'>('input');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setBulkText('');
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
    setSubmitting(true);
    try {
      await post('/members/bulk', {
        members: parsedMembers,
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
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                Season memberships and ice privileges are managed separately after import.
              </p>
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
              <div className="flex-1 overflow-auto min-h-0">
                <div className="hidden sm:block">
                  <table className="app-table w-full">
                    <thead>
                      <tr>
                        <th className="app-table-header-cell">Name</th>
                        <th className="app-table-header-cell">Phone</th>
                        <th className="app-table-header-cell">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedMembers.map((member, index) => (
                        <tr key={`${member.email}-${index}`}>
                          <td className="app-table-cell">{member.name}</td>
                          <td className="app-table-cell">
                            {member.phone ? formatPhone(member.phone) : '-'}
                          </td>
                          <td className="app-table-cell">{member.email || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sm:hidden space-y-3">
                  {parsedMembers.map((member, index) => (
                    <div key={`${member.email}-${index}`} className="app-card p-3">
                      <div className="font-medium">{member.name}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {member.phone ? formatPhone(member.phone) : 'No phone'}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">{member.email || 'No email'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-3 flex-shrink-0">
              <Button variant="secondary" onClick={() => setBulkStep('input')}>
                Back
              </Button>
              <Button onClick={handleBulkSubmit} disabled={submitting}>
                {submitting ? 'Importing…' : `Import ${parsedMembers.length} members`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
