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
import type { VolunteerProgramView } from '../../utils/volunteering';

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
            : 'Volunteer programs, roles, shifts, and credentials.'
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
  const [programs, setPrograms] = useState<VolunteerProgramView[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
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

  const handleArchive = async (program: VolunteerProgramView) => {
    const confirmed = await confirm({
      message: `Archive "${program.title}"? It will be hidden from the volunteering hub but can be restored later.`,
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
      message: `Restore "${program.title}"?`,
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
              className="font-medium text-primary-teal hover:underline"
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
        id: 'roles',
        header: 'Roles',
        renderCell: (row) => String(row.roles.length),
      },
      {
        id: 'shifts',
        header: 'Shifts',
        renderCell: (row) => String(row.shifts.length),
      },
      {
        id: 'managers',
        header: 'Managers',
        renderCell: (row) =>
          row.managers.length === 0 ? '—' : row.managers.map((m) => m.name).join(', '),
      },
      {
        id: 'status',
        header: 'Status',
        align: 'center',
        renderCell: (row) =>
          isArchivedAt(row.archivedAt) ? (
            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              Archived
            </span>
          ) : (
            <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-emerald-900/30 dark:text-emerald-200">
              Active
            </span>
          ),
      },
    ],
    []
  );

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
      ) : programs.length === 0 ? (
        <AppStateCard
          title={includeArchived ? 'No programs match these filters.' : 'No programs yet.'}
          description={
            canCreate
              ? 'Create a volunteer program to start adding roles and shifts.'
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
          rows={programs}
          rowKey={(row) => row.id}
          columns={columns}
          actions={
            canCreate
              ? {
                  widthClassName: 'w-[14rem]',
                  renderActions: (row) => (
                    <SoftDeleteRowActions
                      archived={isArchivedAt(row.archivedAt)}
                      isServerAdmin={isServerAdmin}
                      onArchive={() => handleArchive(row)}
                      onRestore={() => handleRestore(row)}
                      onDeletePermanently={() => handlePermanentDelete(row)}
                    />
                  ),
                }
              : undefined
          }
        />
      )}
    </>
  );
}
