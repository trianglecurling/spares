import { useLocation } from 'react-router-dom';
import PageTabs from './PageTabs';

interface LeagueTabsProps {
  leagueId: string;
  showSheetsTab?: boolean;
  showMaintenanceTab?: boolean;
}

const leagueTabs = [
  { label: 'Overview', path: '' },
  { label: 'Schedule', path: 'schedule' },
  { label: 'Standings', path: 'standings' },
  { label: 'Sheets', path: 'sheets', requiresManager: true },
  { label: 'Schedule generation', path: 'schedule-generation', requiresManager: true },
  { label: 'Teams', path: 'teams' },
  { label: 'Roster', path: 'roster' },
  { label: 'Divisions', path: 'divisions' },
  { label: 'League managers', path: 'managers' },
  { label: 'Maintenance', path: 'maintenance', requiresAdmin: true },
];

export default function LeagueTabs({
  leagueId,
  showSheetsTab = false,
  showMaintenanceTab = false,
}: LeagueTabsProps) {
  const location = useLocation();
  const basePath = `/leagues/${leagueId}`;
  const items = leagueTabs
    .filter((tab) => {
      if (tab.requiresManager) return showSheetsTab;
      if (tab.requiresAdmin) return showMaintenanceTab;
      return true;
    })
    .map((tab) => {
      const to = tab.path ? `${basePath}/${tab.path}` : basePath;
      return {
        key: tab.path || 'overview',
        label: tab.label,
        to,
        isActive: location.pathname === to,
      };
    });

  return <PageTabs items={items} />;
}
