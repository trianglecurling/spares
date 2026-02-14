import { useState } from 'react';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAlert } from '../../contexts/AlertContext';
import api, { formatApiError } from '../../utils/api';

interface LeagueMaintenanceProps {
  leagueId: number;
  leagueName: string;
  canDeleteLeague: boolean;
  onDataCleared: () => void;
  onLeagueDeleted: () => void;
}

interface MaintenanceAction {
  key: string;
  label: string;
  description: string;
  endpoint: string;
  confirmTitle: string;
  confirmMessage: string;
  alsoClears?: string[];
}

const actions: MaintenanceAction[] = [
  {
    key: 'games',
    label: 'Clear games',
    description: 'Delete all scheduled and unscheduled games for this league.',
    endpoint: 'maintenance/games',
    confirmTitle: 'Clear all games',
    confirmMessage:
      'Are you sure you want to delete all games for this league? This cannot be undone.',
  },
  {
    key: 'teams',
    label: 'Clear teams',
    description: 'Delete all teams, their rosters, and bye requests.',
    endpoint: 'maintenance/teams',
    confirmTitle: 'Clear all teams',
    confirmMessage:
      'Are you sure you want to delete all teams for this league? This will also delete all games, team rosters, and bye requests. This cannot be undone.',
    alsoClears: ['games', 'bye requests', 'team rosters'],
  },
  {
    key: 'roster',
    label: 'Clear roster',
    description: 'Remove all members from the league roster.',
    endpoint: 'maintenance/roster',
    confirmTitle: 'Clear league roster',
    confirmMessage:
      'Are you sure you want to clear the entire league roster? This will also delete all games, teams, team rosters, and bye requests. This cannot be undone.',
    alsoClears: ['games', 'teams', 'bye requests', 'team rosters'],
  },
  {
    key: 'bye-requests',
    label: 'Clear bye requests',
    description: 'Delete all bye requests for every team in this league.',
    endpoint: 'maintenance/bye-requests',
    confirmTitle: 'Clear all bye requests',
    confirmMessage:
      'Are you sure you want to delete all bye requests for this league? This cannot be undone.',
  },
  {
    key: 'divisions',
    label: 'Clear divisions',
    description: 'Delete all divisions, along with their teams and games.',
    endpoint: 'maintenance/divisions',
    confirmTitle: 'Clear all divisions',
    confirmMessage:
      'Are you sure you want to delete all divisions for this league? This will also delete all games, teams, team rosters, and bye requests. This cannot be undone.',
    alsoClears: ['games', 'teams', 'bye requests', 'team rosters'],
  },
  {
    key: 'sheet-availability',
    label: 'Clear sheet availability',
    description: 'Delete all sheet availability overrides for this league.',
    endpoint: 'maintenance/sheet-availability',
    confirmTitle: 'Clear sheet availability',
    confirmMessage:
      'Are you sure you want to delete all sheet availability data for this league? This cannot be undone.',
  },
];

export default function LeagueMaintenance({
  leagueId,
  leagueName,
  canDeleteLeague,
  onDataCleared,
  onLeagueDeleted,
}: LeagueMaintenanceProps) {
  const { confirm } = useConfirm();
  const { showAlert } = useAlert();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const handleAction = async (action: MaintenanceAction) => {
    const confirmed = await confirm({
      title: action.confirmTitle,
      message: action.confirmMessage,
      variant: 'danger',
      confirmText: action.label,
      cancelText: 'Cancel',
    });

    if (!confirmed) return;

    setLoadingKey(action.key);
    try {
      await api.delete(`/leagues/${leagueId}/${action.endpoint}`);
      showAlert(`${action.label} completed successfully.`, 'success');
      onDataCleared();
    } catch (error) {
      showAlert(formatApiError(error, `Failed to ${action.label.toLowerCase()}`), 'error');
    } finally {
      setLoadingKey(null);
    }
  };

  const handleDeleteLeague = async () => {
    if (deleteConfirmName !== leagueName) return;
    setDeleteSubmitting(true);
    try {
      await api.delete(`/leagues/${leagueId}`, { data: { name: leagueName } });
      showAlert('League deleted successfully.', 'success');
      setDeleteModalOpen(false);
      setDeleteConfirmName('');
      onLeagueDeleted();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to delete league'), 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleOpenDeleteModal = () => {
    setDeleteConfirmName('');
    setDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    setDeleteModalOpen(false);
    setDeleteConfirmName('');
  };

  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          These actions are destructive and cannot be undone. Use with caution.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {actions.map((action) => (
          <div
            key={action.key}
            className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 flex flex-col justify-between gap-3"
          >
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">{action.label}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{action.description}</p>
              {action.alsoClears && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Also clears: {action.alsoClears.join(', ')}
                </p>
              )}
            </div>
            <Button
              variant="danger"
              onClick={() => handleAction(action)}
              disabled={loadingKey !== null}
            >
              {loadingKey === action.key ? 'Clearing...' : action.label}
            </Button>
          </div>
        ))}
      </div>

      {canDeleteLeague && (
        <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <h3 className="font-medium text-red-900 dark:text-red-200">Delete league</h3>
            <p className="text-sm text-red-800 dark:text-red-300 mt-1">
              Permanently delete this league and all its data: games, teams, bye requests, roster,
              divisions, and sheet availability. This cannot be undone.
            </p>
            <Button
              variant="danger"
              onClick={handleOpenDeleteModal}
              disabled={loadingKey !== null}
              className="mt-3"
            >
              Delete league
            </Button>
          </div>
        </div>
      )}

      <Modal
        isOpen={deleteModalOpen}
        onClose={handleCloseDeleteModal}
        title="Delete league"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            This will permanently delete <strong>{leagueName}</strong> and all its data: games,
            teams, bye requests, roster, divisions, and sheet availability. This cannot be undone.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Type the exact league name to confirm:
          </p>
          <input
            type="text"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={leagueName}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-red-500"
            autoComplete="off"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={handleCloseDeleteModal} disabled={deleteSubmitting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteLeague}
              disabled={deleteConfirmName !== leagueName || deleteSubmitting}
            >
              {deleteSubmitting ? 'Deleting...' : 'Delete league'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
