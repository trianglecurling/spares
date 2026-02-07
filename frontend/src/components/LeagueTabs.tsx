import { Link, useLocation } from 'react-router-dom';

interface LeagueTabsProps {
  leagueId: string;
  showSheetsTab?: boolean;
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
];

export default function LeagueTabs({ leagueId, showSheetsTab = false }: LeagueTabsProps) {
  const location = useLocation();
  const basePath = `/leagues/${leagueId}`;

  return (
    <div className="flex flex-wrap gap-2">
      {leagueTabs
        .filter((tab) => (tab.requiresManager ? showSheetsTab : true))
        .map((tab) => {
        const to = tab.path ? `${basePath}/${tab.path}` : basePath;
        const isActive = location.pathname === to;
        return (
          <Link
            key={tab.label}
            to={to}
            className={`px-3 py-2 rounded-md text-sm font-medium ${
              isActive
                ? 'bg-primary-teal text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
