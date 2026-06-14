import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { del, get, post } from '../../api/client';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import FormField from '../../components/FormField';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { formatPhone } from '../../utils/phone';
import { HiEllipsisVertical } from 'react-icons/hi2';
import type { MemberSummary as Member } from '../../../../backend/src/types.ts';
import AdminMemberEditorModal from './AdminMemberEditorModal';
import AdminMembersBulkImportModal from './AdminMembersBulkImportModal';
import useTableQueryState from '../../hooks/useTableQueryState';

const MEMBERS_PAGE_SIZE = 50;

/** Matches `w-48` — used to align menu with the Actions trigger (`absolute right-0` behavior). */
const MEMBER_ACTIONS_MENU_WIDTH_PX = 192;
const MEMBER_ACTIONS_MENU_VIEWPORT_EDGE = 8;
/** Used before the portaled menu has a measured height. */
const MEMBER_ACTIONS_MENU_ESTIMATE_HEIGHT_PX = 220;

const MEMBER_ADMIN_TABLE_SORT_KEYS = ['name'] as const;
type MemberAdminTableSortKey = (typeof MEMBER_ADMIN_TABLE_SORT_KEYS)[number];

function memberHaystack(member: Member): string {
  return [
    member.name ?? '',
    member.email ?? '',
    member.phone ?? '',
    member.phone ? formatPhone(member.phone) : '',
    String(member.id),
  ]
    .join(' ')
    .toLowerCase();
}

function toTsvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

const memberColumns: Array<DataTableColumn<Member>> = [
  {
    id: 'name',
    header: 'Name',
    renderCell: (member) => (
      <div className="flex items-center">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.name}</div>
        {member.isServerAdmin ? (
          <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-200">
            Server admin
          </span>
        ) : member.isAdmin ? (
          <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
            Admin
          </span>
        ) : member.isLeagueAdministratorGlobal ? (
          <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            League admin
          </span>
        ) : (member as { isSponsorAdmin?: boolean }).isSponsorAdmin ? (
          <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
            Sponsor admin
          </span>
        ) : null}
      </div>
    ),
  },
  {
    id: 'email',
    header: 'Email',
    renderCell: (member) => member.email || '-',
  },
  {
    id: 'phone',
    header: 'Phone',
    renderCell: (member) => (member.phone ? formatPhone(member.phone) : '-'),
  },
  {
    id: 'status',
    header: 'Status',
    renderCell: (member) => (
      <div className="space-y-1">
        {member.optedInSms ? (
          <div className="text-xs text-blue-600 dark:text-blue-400">SMS enabled</div>
        ) : null}
        <div className="text-xs text-gray-400 dark:text-gray-500">
          {member.emailVisible ? 'Email public' : 'Email hidden'} •{' '}
          {member.phoneVisible ? 'Phone public' : 'Phone hidden'}
        </div>
      </div>
    ),
  },
];

export default function AdminMembers() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member: currentMember } = useAuth();
  const membersFilterInputId = useId();
  const memberActionsMenuDomId = useId();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportTsv, setExportTsv] = useState('');
  const [isBulkAddModalOpen, setIsBulkAddModalOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [memberActionsMenuPosition, setMemberActionsMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const memberActionsMenuPopoverRef = useRef<HTMLDivElement | null>(null);

  const memberFilterConfig = useMemo(
    () => ({
      search: {
        queryKey: 'search',
        defaultValue: '',
        debounceMs: 250,
      },
    }),
    []
  );

  const { page, draftFilters, setPage, setDraftFilter } = useTableQueryState<
    MemberAdminTableSortKey,
    { search: string }
  >({
    defaultSort: { key: 'name', direction: 'asc' },
    sortKeys: MEMBER_ADMIN_TABLE_SORT_KEYS,
    filterConfig: memberFilterConfig,
  });

  const filteredMembers = useMemo(() => {
    const q = draftFilters.search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => memberHaystack(m).includes(q));
  }, [draftFilters.search, members]);

  const pagedMembers = useMemo(
    () => filteredMembers.slice((page - 1) * MEMBERS_PAGE_SIZE, page * MEMBERS_PAGE_SIZE),
    [filteredMembers, page]
  );

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredMembers.length / MEMBERS_PAGE_SIZE));
    if (page > maxPage) {
      setPage(maxPage, { replace: true });
    }
  }, [filteredMembers.length, page, setPage]);

  const loadMembers = useCallback(async () => {
    try {
      const response = await get('/members');
      const membersWithBooleans = (response as Member[]).map((m) => ({
        ...m,
        lifetimeMember: Boolean(m.lifetimeMember),
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
        isLastServerAdmin: Boolean(m.isLastServerAdmin),
      }));
      const sorted = membersWithBooleans.sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || '')),
      );
      setMembers(sorted);
      setSelectedMemberIds([]);
    } catch (error) {
      console.error('Failed to load members:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const openMenuMember = useMemo(
    () => (openMenuId === null ? null : (members.find((m) => m.id === openMenuId) ?? null)),
    [members, openMenuId]
  );

  useEffect(() => {
    if (openMenuId !== null && !members.some((m) => m.id === openMenuId)) {
      setOpenMenuId(null);
    }
  }, [members, openMenuId]);

  useLayoutEffect(() => {
    if (openMenuId === null || !openMenuMember) {
      setMemberActionsMenuPosition(null);
      return;
    }

    let cancelled = false;

    const updatePosition = () => {
      if (cancelled) return;
      const anchor = menuRefs.current[openMenuId];
      const trigger = anchor?.querySelector('button');
      if (!(trigger instanceof HTMLButtonElement)) {
        setMemberActionsMenuPosition(null);
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const w = MEMBER_ACTIONS_MENU_WIDTH_PX;
      let left = rect.right - w;
      left = Math.max(
        MEMBER_ACTIONS_MENU_VIEWPORT_EDGE,
        Math.min(left, window.innerWidth - w - MEMBER_ACTIONS_MENU_VIEWPORT_EDGE)
      );

      const gap = MEMBER_ACTIONS_MENU_VIEWPORT_EDGE;
      const panel = memberActionsMenuPopoverRef.current;
      const measured = panel?.offsetHeight && panel.offsetHeight > 0 ? panel.offsetHeight : null;
      const h = measured ?? MEMBER_ACTIONS_MENU_ESTIMATE_HEIGHT_PX;

      let top = rect.bottom + gap;
      if (top + h > window.innerHeight - MEMBER_ACTIONS_MENU_VIEWPORT_EDGE) {
        top = Math.max(
          MEMBER_ACTIONS_MENU_VIEWPORT_EDGE,
          rect.top - h - gap
        );
      }

      setMemberActionsMenuPosition({ top, left });
    };

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePosition);
    };
  }, [openMenuId, openMenuMember]);

  useEffect(() => {
    if (openMenuId === null) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRefs.current[openMenuId]?.contains(target)) return;
      if (memberActionsMenuPopoverRef.current?.contains(target)) return;
      setOpenMenuId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openMenuId]);

  useEffect(() => {
    if (openMenuId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openMenuId]);

  const generateMembersTsv = useCallback(() => {
    const header = [
      'id',
      'name',
      'email',
      'phone',
      'role',
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
      return [
        m.id,
        m.name,
        m.email || '',
        m.phone || '',
        role,
        Boolean(m.emailSubscribed),
        Boolean(m.optedInSms),
        Boolean(m.emailVisible),
        Boolean(m.phoneVisible),
        toTsvCell(m.createdAt),
      ].map(toTsvCell);
    });

    return [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
  }, [members]);

  const handleOpenExportTsv = useCallback(() => {
    if (!members.length) {
      showAlert('No members to export yet', 'warning');
      return;
    }
    const tsv = generateMembersTsv();
    setExportTsv(tsv);
    setIsExportModalOpen(true);
  }, [generateMembersTsv, members.length, showAlert]);

  const handleCopyExportTsv = async () => {
    try {
      await navigator.clipboard.writeText(exportTsv);
      showAlert('TSV copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy TSV:', error);
      showAlert('Failed to copy TSV', 'error');
    }
  };

  const handleOpenModal = useCallback((member?: Member) => {
    if (member) {
      setEditingMember(member);
    } else {
      setEditingMember(null);
    }
    setIsModalOpen(true);
  }, []);

  const handleCloseEditorModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingMember(null);
  }, []);

  const handleDelete = useCallback(
    async (id: number, name: string) => {
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
        setMembers((prev) => prev.filter((m) => m.id !== id));
        setSelectedMemberIds((prev) => prev.filter((i) => i !== id));
      } catch (error) {
        console.error('Failed to delete member:', error);
        showAlert('Failed to delete member', 'error');
      }
    },
    [confirm, currentMember, showAlert]
  );

  const handleSendWelcome = useCallback(
    async (id: number, name: string) => {
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
    },
    [confirm, showAlert]
  );

  const handleCopyLoginLink = useCallback(
    async (id: number, name: string) => {
      try {
        const response = await get('/members/{id}/login-link', undefined, { id: String(id) });
        const loginLink = response.loginLink;

        await navigator.clipboard.writeText(loginLink);
        showAlert(`Login link copied for ${name}!`, 'success');
      } catch (error) {
        console.error('Failed to copy login link:', error);
        showAlert('Failed to copy login link', 'error');
      }
    },
    [showAlert]
  );

  const handleBulkDelete = async () => {
    if (selectedMemberIds.length === 0) return;

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

  const isSelectableMember = useCallback(
    (m: Member) => {
      if (m.id === currentMember?.id) return false;
      if (m.isLastServerAdmin) return false;

      if (!currentMember?.isServerAdmin) {
        if (m.isAdmin || m.isServerAdmin) return false;
      }

      return true;
    },
    [currentMember?.id, currentMember?.isServerAdmin]
  );

  const handleToggleRow = useCallback((member: Member, checked: boolean) => {
    setSelectedMemberIds((current) =>
      checked
        ? Array.from(new Set([...current, member.id]))
        : current.filter((id) => id !== member.id)
    );
  }, []);

  const handleTogglePage = useCallback(
    (rows: Member[], checked: boolean) => {
      const rowIds = rows.filter(isSelectableMember).map((m) => m.id);
      setSelectedMemberIds((current) =>
        checked
          ? Array.from(new Set([...current, ...rowIds]))
          : current.filter((id) => !rowIds.includes(id))
      );
    },
    [isSelectableMember]
  );

  const renderRowActions = useCallback(
    (member: Member) => (
      <div
        className="inline-block"
        ref={(el) => {
          menuRefs.current[member.id] = el;
        }}
      >
        <button
          type="button"
          onClick={() => setOpenMenuId((id) => (id === member.id ? null : member.id))}
          className="rounded-md p-1 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 dark:hover:bg-gray-700"
          aria-label="Actions menu"
          aria-haspopup="menu"
          aria-expanded={openMenuId === member.id}
          aria-controls={openMenuId === member.id ? memberActionsMenuDomId : undefined}
        >
          <HiEllipsisVertical className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </button>
      </div>
    ),
    [memberActionsMenuDomId, openMenuId]
  );

  const selectionConfig = useMemo(
    () => ({
      selectedIds: selectedMemberIds,
      isRowSelectable: isSelectableMember,
      getRowLabel: (m: Member) => m.name,
      onToggleRow: handleToggleRow,
      onTogglePage: handleTogglePage,
    }),
    [handleTogglePage, handleToggleRow, isSelectableMember, selectedMemberIds]
  );

  const actionsConfig = useMemo(
    () => ({
      widthClassName: 'w-[4.5rem]' as const,
      renderActions: renderRowActions,
    }),
    [renderRowActions]
  );

  const paginationConfig = useMemo(
    () => ({
      page,
      pageSize: MEMBERS_PAGE_SIZE,
      totalRecords: filteredMembers.length,
      currentCount: pagedMembers.length,
      onPageChange: setPage,
    }),
    [filteredMembers.length, page, pagedMembers.length, setPage]
  );

  const tableEmptyState = useMemo(() => {
    if (members.length === 0) {
      return <AppStateCard compact title="No members yet." />;
    }
    const q = draftFilters.search.trim();
    return (
      <AppStateCard
        compact
        title={q ? `No members found matching "${q}"` : 'No members match this filter.'}
      />
    );
  }, [draftFilters.search, members.length]);

  const authForEditor =
    currentMember == null
      ? null
      : { id: currentMember.id, isServerAdmin: Boolean(currentMember.isServerAdmin) };

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Manage members"
          actions={
            <Button type="button" onClick={() => handleOpenModal()}>
              Add member
            </Button>
          }
        />

        <AppPageControlsRow
          left={
            <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
              <FormField
                label="Filter members"
                htmlFor={membersFilterInputId}
                className="min-w-[16rem] flex-1"
              >
                <input
                  id={membersFilterInputId}
                  type="search"
                  className="app-input"
                  value={draftFilters.search}
                  onChange={(e) => setDraftFilter('search', e.target.value)}
                  placeholder="Search name, email, phone, or id"
                />
              </FormField>
            </div>
          }
          right={
            <>
              <Button type="button" onClick={handleOpenExportTsv} variant="secondary">
                Export TSV
              </Button>
              <Button type="button" onClick={() => setIsBulkAddModalOpen(true)} variant="secondary">
                Bulk import
              </Button>
              {selectedMemberIds.length > 0 && (
                <>
                  <Button type="button" variant="secondary" onClick={handleBulkSendWelcome}>
                    Send welcome emails ({selectedMemberIds.length})
                  </Button>
                  <Button type="button" variant="danger" onClick={handleBulkDelete}>
                    Delete selected ({selectedMemberIds.length})
                  </Button>
                </>
              )}
            </>
          }
        />

        {loading ? (
          <AppStateCard title="Loading members..." />
        ) : (
          <DataTable
            rows={pagedMembers}
            rowKey={(member) => member.id}
            columns={memberColumns}
            selection={selectionConfig}
            actions={actionsConfig}
            pagination={paginationConfig}
            emptyState={tableEmptyState}
          />
        )}
      </AppPage>

      <AdminMemberEditorModal
        isOpen={isModalOpen}
        editingMember={editingMember}
        currentMember={authForEditor}
        onClose={handleCloseEditorModal}
        onSaved={loadMembers}
      />

      <AdminMembersBulkImportModal
        isOpen={isBulkAddModalOpen}
        onClose={() => setIsBulkAddModalOpen(false)}
        onImported={loadMembers}
      />

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
            <Button type="button" variant="secondary" onClick={() => setIsExportModalOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={handleCopyExportTsv}>
              Copy TSV
            </Button>
          </div>
        </div>
      </Modal>

      {openMenuMember !== null &&
      memberActionsMenuPosition !== null &&
      typeof document !== 'undefined'
        ? createPortal(
            <div
              id={memberActionsMenuDomId}
              ref={memberActionsMenuPopoverRef}
              role="menu"
              aria-label="Member actions"
              style={{
                position: 'fixed',
                top: memberActionsMenuPosition.top,
                left: memberActionsMenuPosition.left,
                width: MEMBER_ACTIONS_MENU_WIDTH_PX,
              }}
              className="z-[100] rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                type="button"
                role="menuitem"
                className="w-full whitespace-nowrap px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                onClick={() => {
                  handleOpenModal(openMenuMember);
                  setOpenMenuId(null);
                }}
              >
                Edit
              </button>
              {currentMember?.isServerAdmin ? (
                <button
                  type="button"
                  role="menuitem"
                  className="w-full whitespace-nowrap px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  onClick={() => {
                    void handleCopyLoginLink(openMenuMember.id, openMenuMember.name);
                    setOpenMenuId(null);
                  }}
                >
                  Copy login link
                </button>
              ) : null}
              {openMenuMember.email ? (
                <button
                  type="button"
                  role="menuitem"
                  className="w-full whitespace-nowrap px-4 py-2 text-left text-sm text-blue-600 hover:bg-gray-100 dark:text-blue-400 dark:hover:bg-gray-700"
                  onClick={() => {
                    void handleSendWelcome(openMenuMember.id, openMenuMember.name);
                    setOpenMenuId(null);
                  }}
                >
                  Send welcome email
                </button>
              ) : null}
              {isSelectableMember(openMenuMember) ? (
                <button
                  type="button"
                  role="menuitem"
                  className="w-full whitespace-nowrap px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700"
                  onClick={() => {
                    void handleDelete(openMenuMember.id, openMenuMember.name);
                    setOpenMenuId(null);
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </Layout>
  );
}
