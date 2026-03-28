import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { del, get, patch, post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { formatPhone } from '../../utils/phone';
import api, { formatApiError } from '../../utils/api';
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
  socialMember?: boolean;
  isServerAdmin?: boolean;
};

type MemberCreatePayload = {
  name: string;
  email: string;
  phone?: string;
  validThrough: string | null;
  spareOnly: boolean;
  socialMember: boolean;
  isServerAdmin?: boolean;
};

type RoleRule = {
  scope: string;
  effect: 'allow' | 'deny';
};

type RbacRole = {
  id: number;
  name: string;
  description: string | null;
  isAssignable: boolean;
  rules: RoleRule[];
};

type MemberAssignmentApi = {
  id?: number;
  roleId: number;
  roleName?: string;
  resourceType?: string | null;
  resourceId?: number | null;
};

type AssignmentDraft = {
  id: string;
  roleId: number;
  resourceType: string;
  resourceId: string;
};

function makeAssignmentDraft(roleId: number): AssignmentDraft {
  return {
    id: crypto.randomUUID(),
    roleId,
    resourceType: '',
    resourceId: '',
  };
}

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
    socialMember: false,
    isServerAdmin: false,
    emailVisible: false,
    phoneVisible: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [assignableRoles, setAssignableRoles] = useState<RbacRole[]>([]);
  const [memberAssignments, setMemberAssignments] = useState<AssignmentDraft[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [activeMemberModalTab, setActiveMemberModalTab] = useState<'details' | 'permissions'>('details');

  // Bulk Add State
  const [isBulkAddModalOpen, setIsBulkAddModalOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkValidThrough, setBulkValidThrough] = useState<string>('');
  const [bulkSpareOnly, setBulkSpareOnly] = useState(false);
  const [bulkSocialMember, setBulkSocialMember] = useState(false);
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

  useEffect(() => {
    if (!isModalOpen || !editingMember || !currentMember?.isServerAdmin) return;
    void loadRoleEditorData(editingMember.id);
  }, [isModalOpen, editingMember?.id, currentMember?.isServerAdmin]);

  const loadMembers = async () => {
    try {
      const response = await get('/members');
      // Ensure boolean values are properly converted
      const membersWithBooleans = (response as Member[]).map((m) => ({
        ...m,
        validThrough: m.validThrough ?? null,
        spareOnly: Boolean(m.spareOnly),
        socialMember: Boolean(m.socialMember),
        emailVisible: Boolean(m.emailVisible),
        phoneVisible: Boolean(m.phoneVisible),
        emailSubscribed: Boolean(m.emailSubscribed),
        optedInSms: Boolean(m.optedInSms),
        isAdmin: Boolean(m.isAdmin),
        isServerAdmin: Boolean(m.isServerAdmin),
        isCalendarAdmin: Boolean((m as { isCalendarAdmin?: boolean }).isCalendarAdmin),
        isContentAdmin: Boolean((m as { isContentAdmin?: boolean }).isContentAdmin),
        isSponsorAdmin: Boolean((m as { isSponsorAdmin?: boolean }).isSponsorAdmin),
        isLeagueAdministrator: Boolean(m.isLeagueAdministratorGlobal),
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

  const loadRoleEditorData = async (memberId: number) => {
    setAssignmentsLoading(true);
    setAssignmentsError(null);
    try {
      const [rolesResponse, assignmentsResponse] = await Promise.all([
        api.get<RbacRole[]>('/rbac/roles'),
        api.get<MemberAssignmentApi[]>(`/rbac/members/${memberId}/assignments`),
      ]);
      const roles = rolesResponse.data.filter((role) => role.isAssignable);
      const firstRoleId = roles[0]?.id ?? 0;
      setAssignableRoles(roles);
      setMemberAssignments(
        assignmentsResponse.data.map((assignment) => ({
          id: crypto.randomUUID(),
          roleId: assignment.roleId || firstRoleId,
          resourceType: assignment.resourceType ?? '',
          resourceId:
            assignment.resourceId === null || assignment.resourceId === undefined
              ? ''
              : String(assignment.resourceId),
        }))
      );
    } catch (error: unknown) {
      setAssignableRoles([]);
      setMemberAssignments([]);
      setAssignmentsError(formatApiError(error, 'Failed to load roles and assignments'));
    } finally {
      setAssignmentsLoading(false);
    }
  };

  const addAssignmentDraft = () => {
    const defaultRoleId = assignableRoles[0]?.id;
    if (!defaultRoleId) return;
    setMemberAssignments((current) => [...current, makeAssignmentDraft(defaultRoleId)]);
  };

  const updateAssignmentDraft = (id: string, patch: Partial<AssignmentDraft>) => {
    setMemberAssignments((current) =>
      current.map((assignment) => (assignment.id === id ? { ...assignment, ...patch } : assignment))
    );
  };

  const removeAssignmentDraft = (id: string) => {
    setMemberAssignments((current) => current.filter((assignment) => assignment.id !== id));
  };

  const handleOpenModal = (member?: Member) => {
    setAssignmentsError(null);
    setActiveMemberModalTab('details');
    if (member) {
      setEditingMember(member);
      // If user is in SERVER_ADMINS, force isServerAdmin to true
      const isServerAdmin = member.isInServerAdminsList ? true : member.isServerAdmin || false;
      setFormData({
        name: member.name,
        email: member.email || '',
        phone: member.phone || '',
        validThrough: member.validThrough || '',
        spareOnly: Boolean(member.spareOnly),
        socialMember: Boolean(member.socialMember),
        isServerAdmin: isServerAdmin,
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
        socialMember: false,
        isServerAdmin: false,
        emailVisible: false,
        phoneVisible: false,
      });
      setAssignableRoles([]);
      setMemberAssignments([]);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingMember(null);
    setActiveMemberModalTab('details');
    setAssignableRoles([]);
    setMemberAssignments([]);
    setAssignmentsError(null);
    setFormData({
      name: '',
      email: '',
      phone: '',
      validThrough: '',
      spareOnly: false,
      socialMember: false,
      isServerAdmin: false,
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

  const isExpired = (
    validThrough?: string | null,
    isAdminFlag?: boolean,
    isServerAdminFlag?: boolean
  ) => {
    if (isAdminFlag || isServerAdminFlag) return false;
    if (!validThrough) return false;
    const today = new Date().toISOString().split('T')[0];
    return today > validThrough;
  };

  const toTsvCell = (value: unknown) => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/[\t\r\n]+/g, ' ')
      .trim();
  };

  const generateMembersTsv = () => {
    const header = [
      'id',
      'name',
      'email',
      'phone',
      'role',
      'spareOnly',
      'socialMember',
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
        Boolean(m.socialMember),
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
          updateData.socialMember = Boolean(formData.socialMember);
        }

        // Only server admins can change server-admin status (and not for themselves)
        if (currentMember?.isServerAdmin && editingMember?.id !== currentMember?.id) {
          if (editingMember?.isInServerAdminsList) {
            updateData.isServerAdmin = true;
          } else {
            updateData.isServerAdmin = formData.isServerAdmin;
          }
        }

        await patch('/members/{id}', updateData, { id: String(editingMember.id) });

        if (currentMember?.isServerAdmin && editingMember?.id !== currentMember?.id) {
          const normalizedAssignments = memberAssignments.map((assignment) => {
            const resourceType = assignment.resourceType.trim();
            const resourceIdRaw = assignment.resourceId.trim();
            if (!assignment.roleId) {
              throw new Error('Each assignment requires a role.');
            }
            if (resourceIdRaw && !/^\d+$/.test(resourceIdRaw)) {
              throw new Error('Resource ID must be a whole number.');
            }
            return {
              roleId: assignment.roleId,
              resourceType: resourceType || null,
              resourceId: resourceIdRaw ? Number(resourceIdRaw) : null,
            };
          });

          await api.put(`/rbac/members/${editingMember.id}/assignments`, {
            assignments: normalizedAssignments,
          });
        }
      } else {
        const createData: MemberCreatePayload = {
          name: formData.name,
          email: formData.email,
          phone: formData.phone || undefined,
          validThrough: formData.validThrough ? formData.validThrough : null,
          spareOnly: Boolean(formData.spareOnly),
          socialMember: Boolean(formData.socialMember),
        };

        // Only server admins can set server-admin status when creating
        if (currentMember?.isServerAdmin) {
          createData.isServerAdmin = formData.isServerAdmin;
        }

        await post('/members', createData);
      }

      await loadMembers();
      handleCloseModal();
    } catch (error) {
      console.error('Failed to save member:', error);
      showAlert(formatApiError(error, 'Failed to save member'), 'error');
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
      await del('/members/{id}', undefined, { id: String(id) });
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
      await post('/members/{id}/send-welcome', undefined, { id: String(id) });
      showAlert('Welcome email sent!', 'success');
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      showAlert('Failed to send welcome email', 'error');
    }
  };

  const handleCopyLoginLink = async (id: number, name: string) => {
    try {
      const response = await get('/members/{id}/login-link', undefined, { id: String(id) });
      const loginLink = response.loginLink;

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
    setBulkSocialMember(false);
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

    const parsed = dataLines
      .map((line) => {
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
      })
      .filter((m) => m.name); // Remove empty rows

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
      await loadMembers();
      setIsBulkAddModalOpen(false);
      setBulkText('');
      setBulkValidThrough('');
      setBulkSpareOnly(false);
      setBulkSocialMember(false);
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
      await post('/members/bulk-delete', { ids: idsToDelete });
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
    const membersWithEmails = members.filter((m) => selectedMemberIds.includes(m.id) && m.email);

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
      const response = await post('/members/bulk-send-welcome', {
        ids: selectedMemberIds,
      });
      showAlert(
        `Welcome emails sent to ${response.sent} member${response.sent === 1 ? '' : 's'}!`,
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
  const deletableMembersCount = members.filter((m) => {
    if (m.id === currentMember?.id) return false;
    if (m.isAdmin) return false;
    // Regular admins cannot select server admins
    if (m.isServerAdmin && !currentMember?.isServerAdmin) return false;
    // SERVER_ADMINS users cannot be selected
    if (m.isInServerAdminsList) return false;
    return true;
  }).length;
  const isAllSelected =
    deletableMembersCount > 0 && selectedMemberIds.length === deletableMembersCount;
  const canEditRoleAccess = Boolean(
    currentMember?.isServerAdmin &&
      editingMember &&
      currentMember &&
      editingMember.id !== currentMember.id
  );

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Manage members"
          actions={
            <>
              <Button onClick={handleOpenExportTsv} variant="secondary">
                Export TSV
              </Button>
              {selectedMemberIds.length > 0 && (
                <>
                  <Button variant="secondary" onClick={handleBulkSendWelcome}>
                    Send welcome emails ({selectedMemberIds.length})
                  </Button>
                  <Button variant="danger" onClick={handleBulkDelete}>
                    Delete selected ({selectedMemberIds.length})
                  </Button>
                </>
              )}
              <Button onClick={handleOpenBulkModal} variant="secondary">
                Bulk import
              </Button>
              <Button onClick={() => handleOpenModal()}>Add member</Button>
            </>
          }
        />

        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : (
          <div className="app-table-shell">
              <table className="app-table">
                <thead className="app-table-head">
                  <tr>
                    <th className="app-table-th w-10">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAll}
                        className="rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                      />
                    </th>
                    <th className="app-table-th">
                      Name
                    </th>
                    <th className="app-table-th">
                      Email
                    </th>
                    <th className="app-table-th">
                      Phone
                    </th>
                    <th className="app-table-th">
                      Status
                    </th>
                    <th className="app-table-th">
                      Valid through
                    </th>
                    <th className="app-table-th text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {members.map((member) => (
                    <tr
                      key={member.id}
                      className={
                        selectedMemberIds.includes(member.id)
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : ''
                      }
                    >
                      <td className="app-table-td">
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
                      <td className="app-table-td">
                        <div className="flex items-center">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {member.name}
                          </div>
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
                          ) : (member as { isSponsorAdmin?: boolean }).isSponsorAdmin ? (
                            <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200">
                              Sponsor admin
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="app-table-td">
                        {member.email || '-'}
                      </td>
                      <td className="app-table-td">
                        {member.phone ? formatPhone(member.phone) : '-'}
                      </td>
                      <td className="app-table-td">
                        <div className="space-y-1">
                          {member.firstLoginCompleted ? (
                            <div className="text-green-600 dark:text-green-400">✓ Registered</div>
                          ) : (
                            <div className="text-gray-400 dark:text-gray-500">Not registered</div>
                          )}
                          {member.optedInSms && (
                            <div className="text-blue-600 dark:text-blue-400 text-xs">
                              SMS enabled
                            </div>
                          )}
                          {member.spareOnly && (
                            <div className="text-xs text-amber-700 dark:text-amber-300">Spare-only</div>
                          )}
                          {member.socialMember && (
                            <div className="text-xs text-amber-700 dark:text-amber-300">Social member</div>
                          )}
                          <div className="text-xs text-gray-400 dark:text-gray-500">
                            {member.emailVisible ? 'Email public' : 'Email hidden'} •{' '}
                            {member.phoneVisible ? 'Phone public' : 'Phone hidden'}
                          </div>
                        </div>
                      </td>
                      <td className="app-table-td">
                        {member.isAdmin || member.isServerAdmin ? (
                          <span className="text-gray-600 dark:text-gray-400">
                            Always valid (admin)
                          </span>
                        ) : !member.validThrough ? (
                          <span className="text-gray-600 dark:text-gray-400">No expiry</span>
                        ) : isExpired(member.validThrough, member.isAdmin, member.isServerAdmin) ? (
                          <span className="text-red-600 dark:text-red-400">
                            Expired ({formatDateDisplay(member.validThrough)})
                          </span>
                        ) : (
                          <span className="text-gray-900 dark:text-gray-100">
                            {formatDateDisplay(member.validThrough)}
                          </span>
                        )}
                      </td>
                      <td className="app-table-td text-right font-medium relative">
                        <div
                          className="relative inline-block"
                          ref={(el) => (menuRefs.current[member.id] = el)}
                        >
                          <button
                            onClick={() =>
                              setOpenMenuId(openMenuId === member.id ? null : member.id)
                            }
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
        )}
      </AppPage>

      {/* Edit/Create Member Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingMember ? 'Edit member' : 'Add member'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {editingMember && (
            <div className="rounded-lg border border-gray-200 p-1 dark:border-gray-700">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setActiveMemberModalTab('details')}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    activeMemberModalTab === 'details'
                      ? 'bg-primary-teal text-white'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMemberModalTab('permissions')}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    activeMemberModalTab === 'permissions'
                      ? 'bg-primary-teal text-white'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  Permissions
                </button>
              </div>
            </div>
          )}

          {(!editingMember || activeMemberModalTab === 'details') && (
            <>
          <div>
            <label
              htmlFor="name"
              className="app-label"
            >
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="app-input"
              required
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="app-label"
            >
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              id="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="app-input"
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
            <label
              htmlFor="phone"
              className="app-label"
            >
              Phone
            </label>
            <input
              type="tel"
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="app-input"
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
            <label
              htmlFor="validThrough"
              className="app-label"
            >
              Valid through (optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                id="validThrough"
                value={formData.validThrough}
                onChange={(e) => setFormData({ ...formData, validThrough: e.target.value })}
                disabled={Boolean(
                  editingMember && currentMember && editingMember.id === currentMember.id
                )}
                className="flex-1 app-input disabled:opacity-60"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setFormData({ ...formData, validThrough: '' })}
                disabled={Boolean(
                  editingMember && currentMember && editingMember.id === currentMember.id
                )}
              >
                Clear
              </Button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Leave empty for perpetual access. Admin/server admin users are always valid regardless
              of this date.
              {editingMember && currentMember && editingMember.id === currentMember.id
                ? ' You cannot change your own date.'
                : ''}
            </p>
          </div>

          <div className="flex items-start">
            <input
              type="checkbox"
              id="spareOnly"
              checked={formData.spareOnly}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  spareOnly: e.target.checked,
                  socialMember: e.target.checked ? false : formData.socialMember,
                })
              }
              disabled={Boolean(
                editingMember && currentMember && editingMember.id === currentMember.id
              )}
              className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal disabled:opacity-60"
            />
            <label htmlFor="spareOnly" className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium">Spare-only member</span>
              <div className="text-gray-600 dark:text-gray-400">
                Can sign up to spare, but cannot create spare requests.
                {editingMember && currentMember && editingMember.id === currentMember.id
                  ? ' You cannot change your own status.'
                  : ''}
              </div>
            </label>
          </div>

          <div className="flex items-start">
            <input
              type="checkbox"
              id="socialMember"
              checked={formData.socialMember}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  socialMember: e.target.checked,
                  spareOnly: e.target.checked ? false : formData.spareOnly,
                })
              }
              disabled={Boolean(
                editingMember && currentMember && editingMember.id === currentMember.id
              )}
              className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal disabled:opacity-60"
            />
            <label htmlFor="socialMember" className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium">Social member</span>
              <div className="text-gray-600 dark:text-gray-400">
                Member without ice privileges: cannot spare, request spares, or be on a league roster.
                {editingMember && currentMember && editingMember.id === currentMember.id
                  ? ' You cannot change your own status.'
                  : ''}
              </div>
            </label>
          </div>
            </>
          )}

          {editingMember && activeMemberModalTab === 'permissions' ? (
            currentMember?.isServerAdmin ? (
            <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Roles & access</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Assign one or more roles to this member. Optional context fields scope a role to a specific
                  resource (example: <code className="px-1 rounded bg-gray-100 dark:bg-gray-700">league / 42</code>).
                </p>
              </div>

              {editingMember.isInServerAdminsList && (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
                  This member is managed by <code>SERVER_ADMINS</code> and must remain a server admin.
                </div>
              )}

              <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/30">
                <input
                  type="checkbox"
                  id="isServerAdmin"
                  checked={formData.isServerAdmin}
                  onChange={(e) => setFormData({ ...formData, isServerAdmin: e.target.checked })}
                  disabled={!canEditRoleAccess || editingMember.isInServerAdminsList}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal disabled:opacity-60"
                />
                <label htmlFor="isServerAdmin" className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Server admin override</span>
                  <div className="text-gray-600 dark:text-gray-400">
                    Grants unrestricted access regardless of assigned roles.
                  </div>
                </label>
              </div>

              {assignmentsLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading role assignments…</div>
              ) : assignmentsError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
                  {assignmentsError}
                </div>
              ) : (
                <div className="space-y-2">
                  {memberAssignments.map((assignment) => {
                    const selectedRole = assignableRoles.find((role) => role.id === assignment.roleId);
                    return (
                      <div
                        key={assignment.id}
                        className="rounded-lg border border-gray-200 bg-white p-3 space-y-2 dark:border-gray-700 dark:bg-gray-800"
                      >
                        <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
                          <select
                            value={assignment.roleId}
                            onChange={(e) =>
                              updateAssignmentDraft(assignment.id, { roleId: Number(e.target.value) })
                            }
                            disabled={!canEditRoleAccess}
                            className="app-input disabled:opacity-60"
                          >
                            {assignableRoles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={assignment.resourceType}
                            onChange={(e) =>
                              updateAssignmentDraft(assignment.id, { resourceType: e.target.value })
                            }
                            disabled={!canEditRoleAccess}
                            placeholder="resourceType"
                            className="app-input disabled:opacity-60"
                          />
                          <input
                            type="text"
                            value={assignment.resourceId}
                            onChange={(e) =>
                              updateAssignmentDraft(assignment.id, {
                                resourceId: e.target.value.replace(/[^\d]/g, ''),
                              })
                            }
                            disabled={!canEditRoleAccess}
                            placeholder="resourceId"
                            className="app-input disabled:opacity-60"
                          />
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => removeAssignmentDraft(assignment.id)}
                            disabled={!canEditRoleAccess}
                          >
                            Remove
                          </Button>
                        </div>
                        {selectedRole?.description && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">{selectedRole.description}</p>
                        )}
                      </div>
                    );
                  })}

                  {memberAssignments.length === 0 && (
                    <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
                      No explicit role assignments yet.
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addAssignmentDraft}
                      disabled={!canEditRoleAccess || assignableRoles.length === 0}
                    >
                      Add role assignment
                    </Button>
                  </div>
                </div>
              )}
            </div>
            ) : (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-300">
              Role assignments are managed in this dialog by server admins.
            </div>
            )
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
                  className="app-input h-64 font-mono text-sm"
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={
                    'First Name\tLast Name\tPhone\tEmail\nJohn\tDoe\t555-0123\tjohn@example.com'
                  }
                />
                <div className="mt-4">
                  <label
                    htmlFor="bulkValidThrough"
                    className="app-label"
                  >
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
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setBulkValidThrough('')}
                    >
                      Clear
                    </Button>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Leave empty for perpetual access. Admin/server admin users are always valid
                    regardless of this date.
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
                  <label
                    htmlFor="bulkSpareOnly"
                    className="text-sm text-gray-700 dark:text-gray-300"
                  >
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
                  <label
                    htmlFor="bulkSocialMember"
                    className="text-sm text-gray-700 dark:text-gray-300"
                  >
                    <span className="font-medium">Mark all imported members as social members</span>
                    <div className="text-gray-600 dark:text-gray-400">
                      No ice privileges: cannot spare, request spares, or join league rosters.
                    </div>
                  </label>
                </div>
              </div>
              <div className="flex justify-end space-x-3 flex-shrink-0">
                <Button variant="secondary" onClick={() => setIsBulkAddModalOpen(false)}>
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
                  {/* Desktop table view */}
                  <div className="hidden sm:block">
                    <table className="app-table">
                      <thead className="app-table-head sticky top-0 z-10">
                        <tr>
                          <th className="app-table-th">
                            Name
                          </th>
                          <th className="app-table-th">
                            Email
                          </th>
                          <th className="app-table-th">
                            Phone
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {parsedMembers.map((m, i) => (
                          <tr key={i}>
                            <td className="app-table-td whitespace-nowrap">
                              {m.name}
                            </td>
                            <td className="app-table-td break-words">
                              {m.email}
                            </td>
                            <td className="app-table-td whitespace-nowrap">
                              {m.phone ? formatPhone(m.phone) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile card view */}
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
                            <span className="font-medium">Phone:</span>{' '}
                            {m.phone ? formatPhone(m.phone) : '—'}
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
            className="app-input flex-1 min-h-0 font-mono text-xs"
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
