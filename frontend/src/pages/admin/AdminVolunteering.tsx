import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import PageTabs from '../../components/PageTabs';
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
  formatVolunteerDateOnly,
  volunteerProgramFirstShiftDate,
  volunteerProgramLastShiftHasEnded,
  volunteerProgramSignupTotals,
  type VolunteerProgramView,
} from '../../utils/volunteering';
import AdminVolunteerProgramDuplicateModal from './AdminVolunteerProgramDuplicateModal';

type VolunteeringTab = 'programs' | 'credentials';

export default function AdminVolunteering() {
  const location = useLocation();
  const navigate = useNavigate();
  const { member } = useAuth();
  const canCreate =
    memberHasScope(member, 'volunteering.manage') || Boolean(member?.isServerAdmin);

  const activeTab: VolunteeringTab = location.pathname.endsWith('/credentials')
    ? 'credentials'
    : 'programs';

  const tabs = useMemo(
    () => [
      {
        key: 'programs',
        label: 'Programs',
        to: '/admin/volunteering',
        isActive: activeTab === 'programs',
      },
      {
        key: 'credentials',
        label: 'Credentials',
        to: '/admin/volunteering/credentials',
        isActive: activeTab === 'credentials',
      },
    ],
    [activeTab]
  );

  return (
    <AppPage>
      <AppPageHeader
        title="Manage volunteering"
        description={
          activeTab === 'credentials'
            ? 'Credentials required for some volunteer roles, and who holds them.'
            : 'Volunteer programs, descriptions, roles, shifts, and credentials.'
        }
        actions={
          activeTab === 'programs' && canCreate ? (
            <Button type="button" onClick={() => navigate('/admin/volunteering/new')}>
              Create program
            </Button>
          ) : undefined
        }
      />
      <PageTabs items={tabs} />
      <Outlet />
    </AppPage>
  );
}

export function AdminVolunteeringPrograms() {
  const navigate = useNavigate();
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
      message: `Archive "${program.title}"? It will be unpublished and hidden from the volunteering hub but can be restored later.`,
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
      message: `Permanently delete "${program.title}"? This removes roles, shifts, and signups.`,
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
    if (includeArchived) return programs;
    const nowIso = new Date().toISOString();
    return programs.filter((program) => !volunteerProgramLastShiftHasEnded(program, nowIso));
  }, [programs, includeArchived]);

  return (
    <>
      {!loading ? (
        <AppPageControlsRow
          right={
            canCreate ? (
              <IncludeArchivedToggle checked={includeArchived} onChange={setIncludeArchived} />
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
              : programs.length > 0
                ? 'No upcoming programs.'
                : 'No programs yet.'
          }
          description={
            !includeArchived && programs.length > 0
              ? 'Past programs are hidden. Include archived items to review them.'
              : canCreate
                ? 'Create a volunteer program to start adding a description, roles, and shifts.'
                : 'You are not a manager of any volunteer programs.'
          }
          action={
            canCreate && !includeArchived ? (
              <Link to="/admin/volunteering/new">
                <Button type="button">Create program</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          rows={visiblePrograms}
          rowKey={(row) => row.id}
          columns={columns}
          actions={
            canCreate
              ? {
                  widthClassName: 'w-[20rem]',
                  renderActions: (row) => (
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
                  ),
                }
              : undefined
          }
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
