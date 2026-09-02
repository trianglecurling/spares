import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import PageTabs from '../../components/PageTabs';
import DragHandle from '../../components/dragDrop/DragHandle';
import SortableList from '../../components/dragDrop/SortableList';
import SortableRow from '../../components/dragDrop/SortableRow';
import IncludeArchivedToggle from '../../components/softDelete/IncludeArchivedToggle';
import SoftDeleteRowActions from '../../components/softDelete/SoftDeleteRowActions';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAuth } from '../../contexts/AuthContext';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { isArchivedAt } from '../../utils/softDelete';
import { memberHasScope } from '../../utils/permissions';
import {
  compareVolunteerProgramsForList,
  formatVolunteerDateOnly,
  volunteerProgramFirstShiftDate,
  volunteerProgramLastShiftHasEnded,
  volunteerProgramSignupTotals,
  parseVolunteerSignupKind,
  type VolunteerProgramView,
} from '../../utils/volunteering';
import AdminVolunteerProgramDuplicateModal from './AdminVolunteerProgramDuplicateModal';

export default function AdminVolunteering() {
  const location = useLocation();
  const navigate = useNavigate();
  const { member } = useAuth();
  const canManageHourLogs =
    memberHasScope(member, 'volunteering.manage') || Boolean(member?.isServerAdmin);
  const hourLogsTab = location.pathname.endsWith('/hour-logs');
  const generalTab = location.pathname.endsWith('/general');

  return (
    <AppPage>
      <AppPageHeader
        title="Manage sign-ups"
        description={
          hourLogsTab
            ? 'Review and manage hours logged for time outside scheduled programs.'
            : generalTab
              ? 'General sign-ups, descriptions, lists, and times.'
              : 'Volunteer programs, descriptions, roles, and shifts.'
        }
      />
      <PageTabs
        items={[
          {
            key: 'volunteering',
            label: 'Volunteering',
            isActive: !hourLogsTab && !generalTab,
            onClick: () => navigate('/admin/volunteering'),
          },
          {
            key: 'general',
            label: 'General sign-ups',
            isActive: generalTab,
            onClick: () => navigate('/admin/volunteering/general'),
          },
          ...(canManageHourLogs
            ? [
                {
                  key: 'hour-logs',
                  label: 'Self-reported hours',
                  isActive: hourLogsTab,
                  onClick: () => navigate('/admin/volunteering/hour-logs'),
                },
              ]
            : []),
        ]}
      />
      <Outlet />
    </AppPage>
  );
}

export function AdminVolunteeringPrograms() {
  const location = useLocation();
  const navigate = useNavigate();
  const generalTab = location.pathname.endsWith('/general');
  const listKind = generalTab ? 'general' : 'volunteering';
  const createProgramTo = `/admin/signups/new?kind=${listKind}`;
  const [programs, setPrograms] = useState<VolunteerProgramView[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [duplicateSourceProgram, setDuplicateSourceProgram] = useState<VolunteerProgramView | null>(
    null
  );
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const canCreate = memberHasScope(member, 'volunteering.manage') || Boolean(member?.isServerAdmin);
  const isServerAdmin = Boolean(member?.isServerAdmin);

  const loadPrograms = () => {
    setLoading(true);
    const params = includeArchived ? { includeArchived: '1' } : undefined;
    api
      .get('/volunteering/admin/programs', { params })
      .then((res) => setPrograms(res.data?.programs || []))
      .catch((err) => showAlert(formatApiError(err, 'Failed to load programs'), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPrograms();
  }, [includeArchived]);

  const handleTogglePublish = async (program: VolunteerProgramView) => {
    try {
      await api.patch(`/volunteering/admin/programs/${program.id}`, {
        published: !program.published,
      });
      showAlert(program.published ? 'Program unpublished' : 'Program published', 'success');
      loadPrograms();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to update program'), 'error');
    }
  };

  const handleArchive = async (program: VolunteerProgramView) => {
    const confirmed = await confirm({
      message: `Archive "${program.title}"? It will be unpublished and hidden from Volunteering & sign-ups but can be restored later.`,
      title: 'Archive program',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.post(`/volunteering/admin/programs/${program.id}/archive`);
      showAlert('Program archived', 'success');
      loadPrograms();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to archive program'), 'error');
    }
  };

  const handleRestore = async (program: VolunteerProgramView) => {
    const confirmed = await confirm({
      message: `Restore "${program.title}"? The program will appear in admin lists again. You can publish it when you are ready.`,
      title: 'Restore program',
      variant: 'info',
    });
    if (!confirmed) return;
    try {
      await api.post(`/volunteering/admin/programs/${program.id}/restore`);
      showAlert('Program restored', 'success');
      loadPrograms();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to restore program'), 'error');
    }
  };

  const handlePermanentDelete = async (program: VolunteerProgramView) => {
    const confirmed = await confirm({
      message: `Permanently delete "${program.title}"? This removes ${
        parseVolunteerSignupKind(program.signupKind) === 'general' ? 'lists, times' : 'roles, shifts'
      }, and signups.`,
      title: 'Delete program',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/volunteering/admin/programs/${program.id}`);
      showAlert('Program deleted', 'success');
      loadPrograms();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete program'), 'error');
    }
  };

  const handleReorder = async (nextVisible: VolunteerProgramView[]) => {
    const remaining = programs
      .filter((program) => parseVolunteerSignupKind(program.signupKind) === listKind)
      .filter((program) => !nextVisible.some((row) => row.id === program.id))
      .sort(compareVolunteerProgramsForList);
    const ordered = [...nextVisible, ...remaining];
    const priorityById = new Map(ordered.map((program, index) => [program.id, index]));
    setPrograms((prev) =>
      prev.map((program) =>
        priorityById.has(program.id) ? { ...program, priority: priorityById.get(program.id)! } : program
      )
    );
    try {
      await api.post('/volunteering/admin/programs/reorder', {
        programIds: ordered.map((program) => program.id),
        signupKind: listKind,
      });
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to update program order'), 'error');
      loadPrograms();
    }
  };

  const renderProgramActions = (row: VolunteerProgramView) => (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setDuplicateSourceProgram(row)}
        className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
        title="Duplicate"
      >
        Duplicate
      </button>
      {!isArchivedAt(row.archivedAt) ? (
        <button
          type="button"
          onClick={() => handleTogglePublish(row)}
          className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
          title={row.published ? 'Unpublish' : 'Publish'}
        >
          {row.published ? 'Unpublish' : 'Publish'}
        </button>
      ) : null}
      <SoftDeleteRowActions
        archived={isArchivedAt(row.archivedAt)}
        isServerAdmin={isServerAdmin}
        onArchive={() => handleArchive(row)}
        onRestore={() => handleRestore(row)}
        onDeletePermanently={() => handlePermanentDelete(row)}
      />
    </div>
  );

  const columns: Array<DataTableColumn<VolunteerProgramView>> = useMemo(
    () => [
      {
        id: 'title',
        header: 'Program',
        cellClassName: 'min-w-[14rem]',
        renderCell: (row) => (
          <div>
            <Link
              to={`/admin/volunteering/${row.id}`}
              className="font-medium text-primary-teal-link hover:underline"
            >
              {row.title}
            </Link>
            {row.location ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">{row.location}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'date',
        header: 'Date',
        cellClassName: 'text-sm text-gray-600 dark:text-gray-400',
        renderCell: (row) => {
          const firstShiftDate = volunteerProgramFirstShiftDate(row);
          return firstShiftDate ? formatVolunteerDateOnly(firstShiftDate) : '—';
        },
      },
      {
        id: 'signups',
        header: 'Sign-ups',
        align: 'right',
        cellClassName: 'text-sm text-gray-700 dark:text-gray-300',
        renderCell: (row) => {
          const { signedUp, needed } = volunteerProgramSignupTotals(row);
          return `${signedUp}/${needed}`;
        },
      },
      {
        id: 'managers',
        header: 'Managers',
        renderCell: (row) =>
          row.managers.length === 0 ? '—' : row.managers.map((m) => m.name).join(', '),
      },
    ],
    []
  );

  const visiblePrograms = useMemo(() => {
    const byKind = programs.filter((program) => parseVolunteerSignupKind(program.signupKind) === listKind);
    const filtered = includeArchived
      ? byKind
      : byKind.filter((program) => !volunteerProgramLastShiftHasEnded(program, new Date().toISOString()));
    return [...filtered].sort(compareVolunteerProgramsForList);
  }, [programs, includeArchived, listKind]);

  return (
    <>
      {!loading ? (
        <AppPageControlsRow
          left={
            canCreate ? (
              <IncludeArchivedToggle checked={includeArchived} onChange={setIncludeArchived} />
            ) : null
          }
          right={
            canCreate ? (
              <Button type="button" onClick={() => navigate(createProgramTo)}>
                Create program
              </Button>
            ) : null
          }
        />
      ) : null}

      {loading ? (
        <AppStateCard title="Loading programs..." />
      ) : visiblePrograms.length === 0 ? (
        <AppStateCard
          title={
            includeArchived
              ? 'No programs match these filters.'
              : programs.some((program) => parseVolunteerSignupKind(program.signupKind) === listKind)
                ? 'No upcoming programs.'
                : generalTab
                  ? 'No general sign-ups yet.'
                  : 'No programs yet.'
          }
          description={
            !includeArchived &&
            programs.some((program) => parseVolunteerSignupKind(program.signupKind) === listKind)
              ? 'Past programs are hidden. Include archived items to review them.'
              : canCreate
                ? generalTab
                  ? 'Create a general sign-up to start adding a description, lists, and times.'
                  : 'Create a volunteer program to start adding a description, roles, and shifts.'
                : 'You are not a manager of any programs in this list.'
          }
          action={
            canCreate && !includeArchived ? (
              <Link to={createProgramTo}>
                <Button type="button">Create program</Button>
              </Link>
            ) : undefined
          }
        />
      ) : canCreate ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Drag programs to change the order they appear on Volunteering & sign-ups and the member dashboard.
          </p>
          <SortableList
            items={visiblePrograms}
            getId={(row) => row.id}
            getItemLabel={(row) => row.title}
            itemNoun="program"
            onReorder={(nextRows) => void handleReorder(nextRows)}
            renderItem={({ item: row, isDragging, isOverlay, dragHandle }) => {
              const firstShiftDate = volunteerProgramFirstShiftDate(row);
              const { signedUp, needed } = volunteerProgramSignupTotals(row);
              return (
                <SortableRow
                  isDragging={isDragging}
                  isOverlay={isOverlay}
                  className="border-gray-200 px-3 py-3 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      {dragHandle}
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/admin/volunteering/${row.id}`}
                            className="font-medium text-primary-teal-link hover:underline"
                          >
                            {row.title}
                          </Link>
                          {!row.published ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              Unpublished
                            </span>
                          ) : null}
                          {isArchivedAt(row.archivedAt) ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              Archived
                            </span>
                          ) : null}
                        </div>
                        {row.location ? (
                          <div className="text-sm text-gray-500 dark:text-gray-400">{row.location}</div>
                        ) : null}
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {firstShiftDate ? formatVolunteerDateOnly(firstShiftDate) : generalTab ? 'No times yet' : 'No shifts yet'}
                          {' · '}
                          {signedUp}/{needed} sign-ups
                          {row.managers.length > 0
                            ? ` · ${row.managers.map((manager) => manager.name).join(', ')}`
                            : ''}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">{renderProgramActions(row)}</div>
                  </div>
                </SortableRow>
              );
            }}
            renderOverlay={(row) => (
              <SortableRow isDragging isOverlay className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <DragHandle label={`Reorder ${row.title}`} disabled />
                  <div className="font-medium">{row.title}</div>
                </div>
              </SortableRow>
            )}
          />
        </div>
      ) : (
        <DataTable
          rows={visiblePrograms}
          rowKey={(row) => row.id}
          columns={columns}
        />
      )}

      <AdminVolunteerProgramDuplicateModal
        sourceProgram={duplicateSourceProgram}
        onClose={() => setDuplicateSourceProgram(null)}
        onDuplicated={(programId) => {
          setDuplicateSourceProgram(null);
          showAlert('Program duplicated', 'success');
          navigate(`/admin/volunteering/${programId}`);
        }}
      />
    </>
  );
}
