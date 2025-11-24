import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface Member {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
  emailSubscribed: boolean;
  optedInSms: boolean;
  createdAt: string;
  emailVisible: boolean;
  phoneVisible: boolean;
}

interface ParsedMember {
  name: string;
  email: string;
  phone: string;
}

export default function AdminMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    isAdmin: false,
    emailVisible: false,
    phoneVisible: false,
  });
  const [submitting, setSubmitting] = useState(false);

  // Bulk Add State
  const [isBulkAddModalOpen, setIsBulkAddModalOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [bulkStep, setBulkStep] = useState<'input' | 'confirm'>('input');

  // Bulk Delete State
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    try {
      const response = await api.get('/members');
      setMembers(response.data);
      // Clear selection on reload to avoid stale IDs
      setSelectedMemberIds([]);
    } catch (error) {
      console.error('Failed to load members:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (member?: Member) => {
    if (member) {
      setEditingMember(member);
      setFormData({
        name: member.name,
        email: member.email || '',
        phone: member.phone || '',
        isAdmin: member.isAdmin,
        emailVisible: member.emailVisible,
        phoneVisible: member.phoneVisible,
      });
    } else {
      setEditingMember(null);
      setFormData({
        name: '',
        email: '',
        phone: '',
        isAdmin: false,
        emailVisible: false,
        phoneVisible: false,
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingMember(null);
    setFormData({
      name: '',
      email: '',
      phone: '',
      isAdmin: false,
      emailVisible: false,
      phoneVisible: false,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (editingMember) {
        await api.patch(`/members/${editingMember.id}`, {
          name: formData.name,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          isAdmin: formData.isAdmin,
          emailVisible: formData.emailVisible,
          phoneVisible: formData.phoneVisible,
        });
      } else {
        await api.post('/members', {
          name: formData.name,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          isAdmin: formData.isAdmin,
        });
      }

      await loadMembers();
      handleCloseModal();
    } catch (error) {
      console.error('Failed to save member:', error);
      alert('Failed to save member');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete ${name}?`)) {
      return;
    }

    try {
      await api.delete(`/members/${id}`);
      setMembers(members.filter((m) => m.id !== id));
      setSelectedMemberIds(selectedMemberIds.filter((i) => i !== id));
    } catch (error) {
      console.error('Failed to delete member:', error);
      alert('Failed to delete member');
    }
  };

  const handleSendWelcome = async (id: number, name: string) => {
    if (!confirm(`Send welcome email to ${name}?`)) {
      return;
    }

    try {
      await api.post(`/members/${id}/send-welcome`);
      alert('Welcome email sent!');
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      alert('Failed to send welcome email');
    }
  };

  // Bulk Add Logic
  const handleOpenBulkModal = () => {
    setBulkText('');
    setParsedMembers([]);
    setBulkStep('input');
    setIsBulkAddModalOpen(true);
  };

  const handleParseBulk = () => {
    if (!bulkText.trim()) {
      alert('Please paste some data');
      return;
    }

    const lines = bulkText.trim().split('\n');
    // Detect delimiter from first line (tab or comma)
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';

    // Assume header row exists, skip it
    const dataLines = lines.length > 1 ? lines.slice(1) : [];
    
    if (dataLines.length === 0) {
      alert('No data found. Please include a header row and at least one member.');
      return;
    }

    const parsed = dataLines.map((line) => {
      // Handle cases where empty columns might be at the end
      const parts = line.split(delimiter).map((p) => p.trim());
      
      // Expected Format: First Name, Last Name, Phone, Email
      const firstName = parts[0] || '';
      const lastName = parts[1] || '';
      const phone = parts[2] || '';
      const email = parts[3] || '';

      return {
        name: `${firstName} ${lastName}`.trim(),
        phone,
        email,
      };
    }).filter(m => m.name); // Remove empty rows

    if (parsed.length === 0) {
      alert('No valid members found in data');
      return;
    }

    setParsedMembers(parsed);
    setBulkStep('confirm');
  };

  const handleBulkSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post('/members/bulk', parsedMembers);
      await loadMembers();
      setIsBulkAddModalOpen(false);
      setBulkText('');
      setParsedMembers([]);
    } catch (error) {
      console.error('Failed to bulk add members:', error);
      alert('Failed to bulk add members');
    } finally {
      setSubmitting(false);
    }
  };

  // Bulk Delete Logic
  const handleSelectAll = () => {
    // Only select non-admins for bulk deletion
    const deletableMemberIds = members
      .filter((m) => !m.isAdmin)
      .map((m) => m.id);

    if (selectedMemberIds.length === deletableMemberIds.length && deletableMemberIds.length > 0) {
      setSelectedMemberIds([]);
    } else {
      setSelectedMemberIds(deletableMemberIds);
    }
  };

  const handleToggleSelect = (id: number) => {
    if (selectedMemberIds.includes(id)) {
      setSelectedMemberIds(selectedMemberIds.filter((i) => i !== id));
    } else {
      setSelectedMemberIds([...selectedMemberIds, id]);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedMemberIds.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedMemberIds.length} members?`)) {
      return;
    }

    setLoading(true);
    try {
      await api.post('/members/bulk-delete', { ids: selectedMemberIds });
      await loadMembers();
      setSelectedMemberIds([]);
    } catch (error) {
      console.error('Failed to bulk delete members:', error);
      alert('Failed to bulk delete members');
    } finally {
      setLoading(false);
    }
  };

  // Computed properties
  const deletableMembersCount = members.filter((m) => !m.isAdmin).length;
  const isAllSelected = 
    deletableMembersCount > 0 && 
    selectedMemberIds.length === deletableMembersCount;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold" style={{ color: '#121033' }}>
            Manage members
          </h1>
          <div className="space-x-3">
            {selectedMemberIds.length > 0 && (
              <Button 
                variant="danger" 
                onClick={handleBulkDelete}
              >
                Delete selected ({selectedMemberIds.length})
              </Button>
            )}
            <Button onClick={handleOpenBulkModal} variant="secondary">
              Bulk import
            </Button>
            <Button onClick={() => handleOpenModal()}>Add member</Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleSelectAll}
                      className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {members.map((member) => (
                  <tr key={member.id} className={selectedMemberIds.includes(member.id) ? 'bg-blue-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {!member.isAdmin && (
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.includes(member.id)}
                          onChange={() => handleToggleSelect(member.id)}
                          className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
                        />
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="text-sm font-medium text-gray-900">{member.name}</div>
                        {member.isAdmin && (
                          <span className="ml-2 px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded">
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {member.email || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {member.phone || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="space-y-1">
                        {member.emailSubscribed ? (
                          <div className="text-green-600">✓ Subscribed</div>
                        ) : (
                          <div className="text-gray-400">Unsubscribed</div>
                        )}
                        {member.optedInSms && (
                          <div className="text-blue-600 text-xs">SMS enabled</div>
                        )}
                        <div className="text-xs text-gray-400">
                          {member.emailVisible ? 'Email public' : 'Email hidden'} •{' '}
                          {member.phoneVisible ? 'Phone public' : 'Phone hidden'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button
                        onClick={() => handleOpenModal(member)}
                        className="text-primary-teal hover:text-opacity-80"
                      >
                        Edit
                      </button>
                      {member.email && (
                        <button
                          onClick={() => handleSendWelcome(member.id, member.name)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Welcome email
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(member.id, member.name)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit/Create Member Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingMember ? 'Edit member' : 'Add member'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              id="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            />
            <div className="mt-2 flex items-center">
              <input
                type="checkbox"
                id="emailVisible"
                checked={formData.emailVisible}
                onChange={(e) => setFormData({ ...formData, emailVisible: e.target.checked })}
                className="mr-2"
              />
              <label htmlFor="emailVisible" className="text-sm text-gray-600">
                Publicly visible
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
              Phone
            </label>
            <input
              type="tel"
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
            />
            <div className="mt-2 flex items-center">
              <input
                type="checkbox"
                id="phoneVisible"
                checked={formData.phoneVisible}
                onChange={(e) => setFormData({ ...formData, phoneVisible: e.target.checked })}
                className="mr-2"
              />
              <label htmlFor="phoneVisible" className="text-sm text-gray-600">
                Publicly visible
              </label>
            </div>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isAdmin"
              checked={formData.isAdmin}
              onChange={(e) => setFormData({ ...formData, isAdmin: e.target.checked })}
              className="mr-2"
            />
            <label htmlFor="isAdmin" className="text-sm font-medium text-gray-700">
              Administrator
            </label>
          </div>

          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Saving...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCloseModal}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bulk Import Modal */}
      <Modal
        isOpen={isBulkAddModalOpen}
        onClose={() => setIsBulkAddModalOpen(false)}
        title="Bulk import members"
        size="xl"
      >
        <div className="flex flex-col h-full min-h-0 space-y-4">
          {bulkStep === 'input' ? (
            <>
              <div className="flex-shrink-0">
                <p className="text-sm text-gray-500 mb-2">
                  Paste your spreadsheet data here. Must include a header row.
                  <br />
                  Expected columns: <strong>First Name, Last Name, Phone, Email</strong>
                </p>
                <textarea
                  className="w-full h-64 p-2 border border-gray-300 rounded font-mono text-sm"
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'First Name\tLast Name\tPhone\tEmail\nJohn\tDoe\t555-0123\tjohn@example.com'}
                />
              </div>
              <div className="flex justify-end space-x-3 flex-shrink-0">
                <Button
                  variant="secondary"
                  onClick={() => setIsBulkAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleParseBulk}>
                  Preview
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 min-h-0 flex flex-col">
                <p className="mb-4 text-sm text-gray-600 flex-shrink-0">
                  Found {parsedMembers.length} members. Please review before importing.
                </p>
                <div className="flex-1 overflow-auto min-h-0">
                  {/* Desktop table view */}
                  <div className="hidden sm:block">
                    <table className="w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {parsedMembers.map((m, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-sm whitespace-nowrap">{m.name}</td>
                            <td className="px-3 py-2 text-sm break-words">{m.email}</td>
                            <td className="px-3 py-2 text-sm whitespace-nowrap">{m.phone || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile card view */}
                  <div className="sm:hidden space-y-3">
                    {parsedMembers.map((m, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="font-medium text-sm mb-1">{m.name}</div>
                        <div className="text-xs text-gray-600">
                          <div className="mb-1">
                            <span className="font-medium">Email:</span> {m.email}
                          </div>
                          <div>
                            <span className="font-medium">Phone:</span> {m.phone || '—'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t flex-shrink-0">
                <Button
                  variant="secondary"
                  onClick={() => setBulkStep('input')}
                  className="w-full sm:w-auto"
                >
                  Back
                </Button>
                <Button onClick={handleBulkSubmit} disabled={submitting} className="w-full sm:w-auto">
                  {submitting ? 'Importing...' : `Import ${parsedMembers.length} Members`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </Layout>
  );
}
