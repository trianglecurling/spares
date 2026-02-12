import { useState } from 'react';
import Button from '../../components/Button';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAlert } from '../../contexts/AlertContext';
import api, { formatApiError } from '../../utils/api';

interface LeagueMaintenanceProps {
  leagueId: number;
  onDataCleared: () => void;
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
    confirmMessage: 'Are you sure you want to delete all games for this league? This cannot be undone.',
  },
  {
    key: 'teams',
    label: 'Clear teams',
    description: 'Delete all teams, their rosters, and bye requests.',
    endpoint: 'maintenance/teams',
    confirmTitle: 'Clear all teams',
    confirmMessage: 'Are you sure you want to delete all teams for this league? This will also delete all games, team rosters, and bye requests. This cannot be undone.',
    alsoClears: ['games', 'bye requests', 'team rosters'],
  },
  {
    key: 'roster',
    label: 'Clear roster',
    description: 'Remove all members from the league roster.',
    endpoint: 'maintenance/roster',
    confirmTitle: 'Clear league roster',
    confirmMessage: 'Are you sure you want to clear the entire league roster? This will also delete all games, teams, team rosters, and bye requests. This cannot be undone.',
    alsoClears: ['games', 'teams', 'bye requests', 'team rosters'],
  },
  {
    key: 'bye-requests',
    label: 'Clear bye requests',
    description: 'Delete all bye requests for every team in this league.',
    endpoint: 'maintenance/bye-requests',
    confirmTitle: 'Clear all bye requests',
    confirmMessage: 'Are you sure you want to delete all bye requests for this league? This cannot be undone.',
  },
  {
    key: 'divisions',
    label: 'Clear divisions',
    description: 'Delete all divisions, along with their teams and games.',
    endpoint: 'maintenance/divisions',
    confirmTitle: 'Clear all divisions',
    confirmMessage: 'Are you sure you want to delete all divisions for this league? This will also delete all games, teams, team rosters, and bye requests. This cannot be undone.',
    alsoClears: ['games', 'teams', 'bye requests', 'team rosters'],
  },
  {
    key: 'sheet-availability',
    label: 'Clear sheet availability',
    description: 'Delete all sheet availability overrides for this league.',
    endpoint: 'maintenance/sheet-availability',
    confirmTitle: 'Clear sheet availability',
    confirmMessage: 'Are you sure you want to delete all sheet availability data for this league? This cannot be undone.',
  },
];

export default function LeagueMaintenance({ leagueId, onDataCleared }: LeagueMaintenanceProps) {
  const { confirm } = useConfirm();
  const { showAlert } = useAlert();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

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
    </div>
  );
}
