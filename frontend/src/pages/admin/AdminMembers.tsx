import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { formatPhone } from '../../utils/phone';
import { HiEllipsisVertical } from 'react-icons/hi2';
import type { MemberSummary as Member } from '../../../../backend/src/types.ts';

interface ParsedMember {
  name: string;
  email: string;
  phone: string;
}

type MemberUpdatePayload = {
  name: string;
  email?: string;
  phone?: string;
  emailVisible: boolean;
  phoneVisible: boolean;
  validThrough?: string | null;
  spareOnly?: boolean;
  isAdmin?: boolean;
  isServerAdmin?: boolean;
  isLeagueAdministrator?: boolean;
};

type MemberCreatePayload = {
  name: string;
  email?: string;
  phone?: string;
  validThrough: string | null;
  spareOnly: boolean;
  isAdmin?: boolean;
  isServerAdmin?: boolean;
  isLeagueAdministrator?: boolean;
};

export default function AdminMembers() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member: currentMember } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportTsv, setExportTsv] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    validThrough: '',
    spareOnly: false,
    isAdmin: false,
    isServerAdmin: false,
    isLeagueAdministrator: false,
    emailVisible: false,
    phoneVisible: false,
  });
  const [submitting, setSubmitting] = useState(false);

  // Bulk Add State
  const [isBulkAddModalOpen, setIsBulkAddModalOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkValidThrough, setBulkValidThrough] = useState<string>('');
  const [bulkSpareOnly, setBulkSpareOnly] = useState(false);
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [bulkStep, setBulkStep] = useState<'input' | 'confirm'>('input');

  // Bulk Delete State
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);

  // Dropdown menu state
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const menuRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  useEffect(() => {
    loadMembers();
  }, []);

  // Close dropdown menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openMenuId !== null) {
        const menuRef = menuRefs.current[openMenuId];
        if (menuRef && !menuRef.contains(event.target as Node)) {
          setOpenMenuId(null);
        }
      }
    };

    if (openMenuId !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId]);

  const loadMembers = async () => {
    try {
      const response = await api.get('/members');
      // Ensure boolean values are properly converted
      const membersWithBooleans = (response.data as Member[]).map((m) => ({
        ...m,
        validThrough: m.validThrough ?? null,
        spareOnly: Boolean(m.spareOnly),
        emailVisible: Boolean(m.emailVisible),
        phoneVisible: Boolean(m.phoneVisible),
        emailSubscribed: Boolean(m.emailSubscribed),
        optedInSms: Boolean(m.optedInSms),
        isAdmin: Boolean(m.isAdmin),
        isServerAdmin: Boolean(m.isServerAdmin),
        isLeagueAdministratorGlobal: Boolean(m.isLeagueAdministratorGlobal),
        isInServerAdminsList: Boolean(m.isInServerAdminsList),
        firstLoginCompleted: Boolean(m.firstLoginCompleted),
      }));
      // Sort so expired members appear at the end
      const sorted = membersWithBooleans.sort((a, b) => {
        const aExpired = isExpired(a.validThrough, a.isAdmin, a.isServerAdmin) ? 1 : 0;
        const bExpired = isExpired(b.validThrough, b.isAdmin, b.isServerAdmin) ? 1 : 0;
        if (aExpired !== bExpired) return aExpired - bExpired;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      setMembers(sorted);
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
      // If user is in SERVER_ADMINS, force isServerAdmin to true
      const isServerAdmin = member.isInServerAdminsList ? true : (member.isServerAdmin || false);
      setFormData({
        name: member.name,
        email: member.email || '',
        phone: member.phone || '',
        validThrough: member.validThrough || '',
        spareOnly: Boolean(member.spareOnly),
        isAdmin: member.isInServerAdminsList ? false : member.isAdmin,
        isServerAdmin: isServerAdmin,
        isLeagueAdministrator: Boolean(member.isLeagueAdministratorGlobal),
        emailVisible: member.emailVisible,
        phoneVisible: member.phoneVisible,
      });
    } else {
      setEditingMember(null);
      setFormData({
        name: '',
        email: '',
        phone: '',
        validThrough: '',
        spareOnly: false,
        isAdmin: false,
        isServerAdmin: false,
        isLeagueAdministrator: false,
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
      validThrough: '',
      spareOnly: false,
      isAdmin: false,
      isServerAdmin: false,
      isLeagueAdministrator: false,
      emailVisible: false,
      phoneVisible: false,
    });
  };

  const formatDateDisplay = (dateString?: string | null) => {
    if (!dateString) return '';
    // Adjust for timezone offset so YYYY-MM-DD displays correctly in local timezone
    const date = new Date(dateString);
    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
    return adjustedDate.toLocaleDateString();
  };

  const formatDateIso = (dateString?: string | null) => {
    if (!dateString) return '';
    if (typeof dateString === 'string') return dateString;
    try {
      return new Date(dateString).toISOString().split('T')[0];
    } catch {
      return String(dateString);
    }
  };

  const isExpired = (validThrough?: string | null, isAdminFlag?: boolean, isServerAdminFlag?: boolean) => {
    if (isAdminFlag || isServerAdminFlag) return false;
    if (!validThrough) return false;
    const today = new Date().toISOString().split('T')[0];
    return today > validThrough;
  };

  const toTsvCell = (value: unknown) => {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[\t\r\n]+/g, ' ').trim();
  };

  const generateMembersTsv = () => {
    const header = [
      'id',
      'name',
      'email',
      'phone',
      'role',
      'spareOnly',
      'validThrough',
      'expired',
      'registered',
      'emailSubscribed',
      'optedInSms',
      'emailVisible',
      'phoneVisible',
      'createdAt',
    ];

    const rows = members.map((m) => {
      const role = m.isServerAdmin
        ? 'server_admin'
        : m.isAdmin
          ? 'admin'
          : m.isLeagueAdministratorGlobal
            ? 'league_admin'
            : 'member';
      const expired = isExpired(m.validThrough, m.isAdmin, m.isServerAdmin);
      return [
        m.id,
        m.name,
        m.email || '',
        m.phone || '',
        role,
        Boolean(m.spareOnly),
        formatDateIso(m.validThrough),
        expired,
        Boolean(m.firstLoginCompleted),
        Boolean(m.emailSubscribed),
        Boolean(m.optedInSms),
        Boolean(m.emailVisible),
        Boolean(m.phoneVisible),
        toTsvCell(m.createdAt),
      ].map(toTsvCell);
    });

    return [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
  };

  const handleOpenExportTsv = () => {
    if (!members.length) {
      showAlert('No members to export yet', 'warning');
      return;
    }
    const tsv = generateMembersTsv();
    setExportTsv(tsv);
    setIsExportModalOpen(true);
  };

  const handleCopyExportTsv = async () => {
    try {
      await navigator.clipboard.writeText(exportTsv);
      showAlert('TSV copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy TSV:', error);
      showAlert('Failed to copy TSV', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (editingMember) {
        const updateData: MemberUpdatePayload = {
          name: formData.name,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          emailVisible: formData.emailVisible,
          phoneVisible: formData.phoneVisible,
        };

        // Valid-through can be edited for other members only (never self)
        if (editingMember?.id !== currentMember?.id) {
          updateData.validThrough = formData.validThrough ? formData.validThrough : null;
          updateData.spareOnly = Boolean(formData.spareOnly);
        }
        
        // Only server admins can set roles (and not for themselves)
        if (currentMember?.isServerAdmin && editingMember?.id !== currentMember?.id) {
          // If user is in SERVER_ADMINS, they must remain server admin
          if (editingMember?.isInServerAdminsList) {
            updateData.isServerAdmin = true;
            updateData.isAdmin = false;
          } else {
            updateData.isAdmin = formData.isAdmin;
            updateData.isServerAdmin = formData.isServerAdmin;
            updateData.isLeagueAdministrator = formData.isLeagueAdministrator;
          }
        } else if (currentMember?.isAdmin && editingMember?.id !== currentMember?.id) {
          // Regular admins can only set isAdmin (and not for themselves)
          updateData.isAdmin = formData.isAdmin;
          updateData.isLeagueAdministrator = formData.isLeagueAdministrator;
        }
        
        await api.patch(`/members/${editingMember.id}`, updateData);
      } else {
        const createData: MemberCreatePayload = {
          name: formData.name,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          validThrough: formData.validThrough ? formData.validThrough : null,
          spareOnly: Boolean(formData.spareOnly),
        };
        
        // Only server admins can set roles when creating
        if (currentMember?.isServerAdmin) {
          createData.isAdmin = formData.isAdmin;
          createData.isServerAdmin = formData.isServerAdmin;
          createData.isLeagueAdministrator = formData.isLeagueAdministrator;
        } else if (currentMember?.isAdmin) {
          // Regular admins can only set isAdmin
          createData.isAdmin = formData.isAdmin;
          createData.isLeagueAdministrator = formData.isLeagueAdministrator;
        }
        
        await api.post('/members', createData);
      }

      await loadMembers();
      handleCloseModal();
    } catch (error) {
      console.error('Failed to save member:', error);
      showAlert('Failed to save member', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    // Prevent self-deletion
    if (currentMember && id === currentMember.id) {
      showAlert('You cannot delete yourself', 'warning');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete member',
      message: `Are you sure you want to delete ${name}? This action cannot be undone.`,
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/members/${id}`);
      setMembers(members.filter((m) => m.id !== id));
      setSelectedMemberIds(selectedMemberIds.filter((i) => i !== id));
    } catch (error) {
      console.error('Failed to delete member:', error);
      showAlert('Failed to delete member', 'error');
    }
  };

  const handleSendWelcome = async (id: number, name: string) => {
    const confirmed = await confirm({
      title: 'Send welcome email',
      message: `Send welcome email to ${name}?`,
      variant: 'info',
      confirmText: 'Send',
    });

    if (!confirmed) {
      return;
    }

    try {
      await api.post(`/members/${id}/send-welcome`);
      showAlert('Welcome email sent!', 'success');
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      showAlert('Failed to send welcome email', 'error');
    }
  };

  const handleCopyLoginLink = async (id: number, name: string) => {
    try {
      const response = await api.get(`/members/${id}/login-link`);
      const loginLink = response.data.loginLink;
      
      await navigator.clipboard.writeText(loginLink);
      showAlert(`Login link copied for ${name}!`, 'success');
    } catch (error) {
      console.error('Failed to copy login link:', error);
      showAlert('Failed to copy login link', 'error');
    }
  };

  // Bulk Add Logic
  const handleOpenBulkModal = () => {
    setBulkText('');
    setBulkValidThrough('');
    setBulkSpareOnly(false);
    setParsedMembers([]);
    setBulkStep('input');
    setIsBulkAddModalOpen(true);
  };

  const handleParseBulk = () => {
    if (!bulkText.trim()) {
      showAlert('Please paste some data', 'warning');
      return;
    }

    const lines = bulkText.trim().split('\n');
    // Detect delimiter from first line (tab or comma)
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';

    // Assume header row exists, skip it
    const dataLines = lines.length > 1 ? lines.slice(1) : [];
    
    if (dataLines.length === 0) {
      showAlert('No data found. Please include a header row and at least one member.', 'warning');
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
      showAlert('No valid members found in data', 'warning');
      return;
    }

    setParsedMembers(parsed);
    setBulkStep('confirm');
  };

  const handleBulkSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post('/members/bulk', {
        members: parsedMembers,
        validThrough: bulkValidThrough ? bulkValidThrough : null,
        spareOnly: bulkSpareOnly,
      });
      await loadMembers();
      setIsBulkAddModalOpen(false);
      setBulkText('');
      setBulkValidThrough('');
      setBulkSpareOnly(false);
      setParsedMembers([]);
    } catch (error) {
      console.error('Failed to bulk add members:', error);
      showAlert('Failed to bulk add members', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Bulk Delete Logic
  const handleSelectAll = () => {
    // Get all selectable members (excluding admins, server admins for regular admins, SERVER_ADMINS users, and self)
    const deletableMemberIds = members
      .filter((m) => {
        if (m.id === currentMember?.id) return false;
        if (m.isAdmin) return false;
        // Regular admins cannot select server admins
        if (m.isServerAdmin && !currentMember?.isServerAdmin) return false;
        // SERVER_ADMINS users cannot be selected
        if (m.isInServerAdminsList) return false;
        return true;
      })
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

    // Filter out current user from selected IDs
    const idsToDelete = currentMember
      ? selectedMemberIds.filter((id) => id !== currentMember.id)
      : selectedMemberIds;

    if (idsToDelete.length === 0) {
      showAlert('You cannot delete yourself', 'warning');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete members',
      message: `Are you sure you want to delete ${idsToDelete.length} member${idsToDelete.length === 1 ? '' : 's'}? This action cannot be undone.`,
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    setLoading(true);
    try {
      await api.post('/members/bulk-delete', { ids: idsToDelete });
      await loadMembers();
      setSelectedMemberIds([]);
    } catch (error) {
      console.error('Failed to bulk delete members:', error);
      showAlert('Failed to bulk delete members', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSendWelcome = async () => {
    if (selectedMemberIds.length === 0) return;

    // Filter to only members with email addresses
    const membersWithEmails = members.filter(
      (m) => selectedMemberIds.includes(m.id) && m.email
    );

    if (membersWithEmails.length === 0) {
      showAlert('No selected members have email addresses', 'warning');
      return;
    }

    const confirmed = await confirm({
      title: 'Send welcome emails',
      message: `Send welcome emails to ${membersWithEmails.length} member${membersWithEmails.length === 1 ? '' : 's'}?`,
      variant: 'info',
      confirmText: 'Send',
    });

    if (!confirmed) {
      return;
    }

    try {
      const response = await api.post('/members/bulk-send-welcome', {
        ids: selectedMemberIds,
      });
      showAlert(
        `Welcome emails sent to ${response.data.sent} member${response.data.sent === 1 ? '' : 's'}!`,
        'success'
      );
    } catch (error: unknown) {
      console.error('Failed to send welcome emails:', error);
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.error || 'Failed to send welcome emails'
        : 'Failed to send welcome emails';
      showAlert(errorMessage, 'error');
    }
  };

  // Computed properties
  const deletableMembersCount = members.filter(
    (m) => {
      if (m.id === currentMember?.id) return false;
      if (m.isAdmin) return false;
      // Regular admins cannot select server admins
      if (m.isServerAdmin && !currentMember?.isServerAdmin) return false;
      // SERVER_ADMINS users cannot be selected
      if (m.isInServerAdminsList) return false;
      return true;
    }
  ).length;
  const isAllSelected = 
    deletableMembersCount > 0 && 
    selectedMemberIds.length === deletableMembersCount;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
            Manage members
          </h1>
          <div className="space-x-3">
            <Button onClick={handleOpenExportTsv} variant="secondary">
              Export TSV
            </Button>
            {selectedMemberIds.length > 0 && (
              <>
                <Button 
                  variant="secondary" 
                  onClick={handleBulkSendWelcome}
                >
                  Send welcome emails ({selectedMemberIds.length})
                </Button>
                <Button 
                  variant="danger" 
                  onClick={handleBulkDelete}
                >
                  Delete selected ({selectedMemberIds.length})
                </Button>
              </>
            )}
            <Button onClick={handleOpenBulkModal} variant="secondary">
              Bulk import
            </Button>
            <Button onClick={() => handleOpenModal()}>Add member</Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-10">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleSelectAll}
                      className="rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Valid through
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {members.map((member) => (
                  <tr key={member.id} className={selectedMemberIds.includes(member.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {!member.isAdmin && 
                       (!currentMember || member.id !== currentMember.id) &&
                       // Regular admins cannot select server admins for deletion
                       !(member.isServerAdmin && !currentMember?.isServerAdmin) &&
                       // SERVER_ADMINS users cannot be selected for deletion
                       !member.isInServerAdminsList && (
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.includes(member.id)}
                          onChange={() => handleToggleSelect(member.id)}
                          className="rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                        />
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.name}</div>
                        {member.isServerAdmin ? (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200">
                            Server admin
                          </span>
                        ) : member.isAdmin ? (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                            Admin
                          </span>
                        ) : member.isLeagueAdministratorGlobal ? (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200">
                            League admin
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {member.email || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {member.phone ? formatPhone(member.phone) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="space-y-1">
                        {member.firstLoginCompleted ? (
                          <div className="text-green-600 dark:text-green-400">✓ Registered</div>
                        ) : (
                          <div className="text-gray-400 dark:text-gray-500">Not registered</div>
                        )}
                        {member.optedInSms && (
                          <div className="text-blue-600 dark:text-blue-400 text-xs">SMS enabled</div>
                        )}
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {member.emailVisible ? 'Email public' : 'Email hidden'} •{' '}
                          {member.phoneVisible ? 'Phone public' : 'Phone hidden'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {member.isAdmin || member.isServerAdmin ? (
                        <span className="text-gray-600 dark:text-gray-400">Always valid (admin)</span>
                      ) : !member.validThrough ? (
                        <span className="text-gray-600 dark:text-gray-400">No expiry</span>
                      ) : isExpired(member.validThrough, member.isAdmin, member.isServerAdmin) ? (
                        <span className="text-red-600 dark:text-red-400">
                          Expired ({formatDateDisplay(member.validThrough)})
                        </span>
                      ) : (
                        <span className="text-gray-900 dark:text-gray-100">{formatDateDisplay(member.validThrough)}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium relative">
                      <div className="relative inline-block" ref={(el) => (menuRefs.current[member.id] = el)}>
                        <button
                          onClick={() => setOpenMenuId(openMenuId === member.id ? null : member.id)}
                          className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2"
                          aria-label="Actions menu"
                        >
                          <HiEllipsisVertical className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                        </button>
                        {openMenuId === member.id && (
                          <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border border-gray-200 dark:border-gray-700">
                            <div className="py-1 flex flex-col">
                              <button
                                onClick={() => {
                                  handleOpenModal(member);
                                  setOpenMenuId(null);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                              >
                                Edit
                              </button>
                              {currentMember?.isServerAdmin && (
                                <button
                                  onClick={() => {
                                    handleCopyLoginLink(member.id, member.name);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                                >
                                  Copy login link
                                </button>
                              )}
                              {member.email && (
                                <button
                                  onClick={() => {
                                    handleSendWelcome(member.id, member.name);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                                >
                                  Send welcome email
                                </button>
                              )}
                              {(!currentMember || member.id !== currentMember.id) && 
                               // Regular admins cannot delete server admins
                               !(member.isServerAdmin && !currentMember?.isServerAdmin) &&
                               // SERVER_ADMINS users cannot be deleted by anyone
                               !member.isInServerAdminsList && (
                                <button
                                  onClick={() => {
                                    handleDelete(member.id, member.name);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              id="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
              <label htmlFor="emailVisible" className="text-sm text-gray-600 dark:text-gray-400">
                Publicly visible
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Phone
            </label>
            <input
              type="tel"
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
            />
            <div className="mt-2 flex items-center">
              <input
                type="checkbox"
                id="phoneVisible"
                checked={formData.phoneVisible}
                onChange={(e) => setFormData({ ...formData, phoneVisible: e.target.checked })}
                className="mr-2"
              />
              <label htmlFor="phoneVisible" className="text-sm text-gray-600 dark:text-gray-400">
                Publicly visible
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="validThrough" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Valid through (optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                id="validThrough"
                value={formData.validThrough}
                onChange={(e) => setFormData({ ...formData, validThrough: e.target.value })}
                disabled={Boolean(editingMember && currentMember && editingMember.id === currentMember.id)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent disabled:opacity-60"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setFormData({ ...formData, validThrough: '' })}
                disabled={Boolean(editingMember && currentMember && editingMember.id === currentMember.id)}
              >
                Clear
              </Button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Leave empty for perpetual access. Admin/server admin users are always valid regardless of this date.
              {editingMember && currentMember && editingMember.id === currentMember.id ? ' You cannot change your own date.' : ''}
            </p>
          </div>

          <div className="flex items-start">
            <input
              type="checkbox"
              id="spareOnly"
              checked={formData.spareOnly}
              onChange={(e) => setFormData({ ...formData, spareOnly: e.target.checked })}
              disabled={Boolean(editingMember && currentMember && editingMember.id === currentMember.id)}
              className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal disabled:opacity-60"
            />
            <label htmlFor="spareOnly" className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium">Spare-only member</span>
              <div className="text-gray-600 dark:text-gray-400">
                Can sign up to spare, but cannot create spare requests.
                {editingMember && currentMember && editingMember.id === currentMember.id ? ' You cannot change your own status.' : ''}
              </div>
            </label>
          </div>

          {currentMember?.isServerAdmin && editingMember?.id !== currentMember?.id ? (
            <div className="space-y-3">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</div>
              {editingMember?.isInServerAdminsList ? (
                <div className="space-y-2">
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                    <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      This user is in SERVER_ADMINS and must remain a server admin. Role cannot be changed.
                    </p>
                  </div>
                  <div className="flex items-center opacity-60">
                    <input
                      type="radio"
                      id="roleServerAdminLocked"
                      name="role"
                      checked={true}
                      disabled
                      className="mr-2"
                    />
                    <label htmlFor="roleServerAdminLocked" className="text-sm text-gray-700 dark:text-gray-300">
                      Server admin (locked)
                    </label>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="roleRegular"
                      name="role"
                      checked={!formData.isAdmin && !formData.isServerAdmin && !formData.isLeagueAdministrator}
                      onChange={() =>
                        setFormData({ ...formData, isAdmin: false, isServerAdmin: false, isLeagueAdministrator: false })
                      }
                      className="mr-2"
                    />
                    <label htmlFor="roleRegular" className="text-sm text-gray-700 dark:text-gray-300">
                      Regular user
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="roleLeagueAdmin"
                      name="role"
                      checked={formData.isLeagueAdministrator && !formData.isAdmin && !formData.isServerAdmin}
                      onChange={() =>
                        setFormData({ ...formData, isAdmin: false, isServerAdmin: false, isLeagueAdministrator: true })
                      }
                      className="mr-2"
                    />
                    <label htmlFor="roleLeagueAdmin" className="text-sm text-gray-700 dark:text-gray-300">
                      League admin
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="roleAdmin"
                      name="role"
                      checked={formData.isAdmin && !formData.isServerAdmin}
                      onChange={() =>
                        setFormData({ ...formData, isAdmin: true, isServerAdmin: false, isLeagueAdministrator: false })
                      }
                      className="mr-2"
                    />
                    <label htmlFor="roleAdmin" className="text-sm text-gray-700 dark:text-gray-300">
                      Admin
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="roleServerAdmin"
                      name="role"
                      checked={formData.isServerAdmin}
                      onChange={() =>
                        setFormData({ ...formData, isAdmin: false, isServerAdmin: true, isLeagueAdministrator: false })
                      }
                      className="mr-2"
                    />
                    <label htmlFor="roleServerAdmin" className="text-sm text-gray-700 dark:text-gray-300">
                      Server admin
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : currentMember?.isAdmin && !editingMember?.isServerAdmin && editingMember?.id !== currentMember?.id ? (
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={formData.isAdmin}
                  onChange={(e) => setFormData({ ...formData, isAdmin: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="isAdmin" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Administrator
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isLeagueAdministrator"
                  checked={formData.isLeagueAdministrator}
                  onChange={(e) => setFormData({ ...formData, isLeagueAdministrator: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="isLeagueAdministrator" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  League admin
                </label>
              </div>
            </div>
          ) : null}

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
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  Paste your spreadsheet data here. Must include a header row.
                  <br />
                  Expected columns: <strong>First Name, Last Name, Phone, Email</strong>
                </p>
                <textarea
                  className="w-full h-64 p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded font-mono text-sm"
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'First Name\tLast Name\tPhone\tEmail\nJohn\tDoe\t555-0123\tjohn@example.com'}
                />
                <div className="mt-4">
                  <label htmlFor="bulkValidThrough" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Valid through for all imported members (optional)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      id="bulkValidThrough"
                      value={bulkValidThrough}
                      onChange={(e) => setBulkValidThrough(e.target.value)}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
                    onChange={(e) => setBulkSpareOnly(e.target.checked)}
                    className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                  />
                  <label htmlFor="bulkSpareOnly" className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium">Mark all imported members as spare-only</span>
                    <div className="text-gray-600 dark:text-gray-400">
                      Spare-only members can sign up to spare, but cannot create spare requests.
                    </div>
                  </label>
                </div>
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
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
                  Found {parsedMembers.length} members. Please review before importing.
                </p>
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
                  Valid through for all imported members:{' '}
                  <span className="font-medium dark:text-gray-200">
                    {bulkValidThrough ? formatDateDisplay(bulkValidThrough) : 'No expiry'}
                  </span>
                </p>
                <div className="flex-1 overflow-auto min-h-0">
                  {/* Desktop table view */}
                  <div className="hidden sm:block">
                    <table className="w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Email</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Phone</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {parsedMembers.map((m, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-sm whitespace-nowrap dark:text-gray-100">{m.name}</td>
                            <td className="px-3 py-2 text-sm break-words dark:text-gray-100">{m.email}</td>
                            <td className="px-3 py-2 text-sm whitespace-nowrap dark:text-gray-100">{m.phone ? formatPhone(m.phone) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile card view */}
                  <div className="sm:hidden space-y-3">
                    {parsedMembers.map((m, i) => (
                      <div key={i} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
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
                <Button onClick={handleBulkSubmit} disabled={submitting} className="w-full sm:w-auto">
                  {submitting ? 'Importing...' : `Import ${parsedMembers.length} Members`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Export TSV Modal */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        title="Export members (TSV)"
        size="xl"
      >
        <div className="flex flex-col h-full min-h-0 space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Copy and paste this into a spreadsheet (tab-separated values).
          </div>
          <textarea
            className="w-full flex-1 min-h-0 p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded font-mono text-xs"
            value={exportTsv}
            readOnly
          />
          <div className="flex justify-end space-x-3">
            <Button variant="secondary" onClick={() => setIsExportModalOpen(false)}>
              Close
            </Button>
            <Button onClick={handleCopyExportTsv}>Copy TSV</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
