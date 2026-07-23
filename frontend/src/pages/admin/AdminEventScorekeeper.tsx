import { Link, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import TournamentScorekeeperView from '../../components/tournament/TournamentScorekeeperView';
import { useTournamentDrawResults } from '../../hooks/useTournamentDrawResults';

export default function AdminEventScorekeeper() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number.parseInt(id ?? '', 10);
  const validId = Number.isFinite(eventId) && eventId > 0;

  const { draw, teams, eventTitle, tournamentFormat, loading, loadError, saveStatus, updateDrawForResults, replaceDrawAndPersist } =
    useTournamentDrawResults(validId ? eventId : 0);

  if (!validId) {
    return (
      <AppPage>
        <AppStateCard title="Event not found" description="This event id is not valid." />
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={eventTitle ? `${eventTitle} · Scorekeeper` : 'Scorekeeper'}
        description="Enter game results. Changes save automatically."
        actions={<BackButton to={`/admin/events/${eventId}/tournament`} label="Tournament" />}
      />

      {loading ? (
        <AppStateCard title="Loading draw…" description="" />
      ) : loadError ? (
        <AppStateCard
          title="Could not load draw"
          description={loadError}
          action={
            <Link to={`/admin/events/${eventId}/tournament`} className="text-sm font-medium text-primary-teal-link hover:underline">
              Back to tournament
            </Link>
          }
        />
      ) : !draw ? (
        <AppStateCard
          title="No tournament draw yet"
          description="Set up the draw on the Tournament tab before entering results."
          action={
            <Link
              to={`/admin/events/${eventId}/tournament#structure`}
              className="text-sm font-medium text-primary-teal-link hover:underline"
            >
              Open tournament
            </Link>
          }
        />
      ) : (
        <TournamentScorekeeperView
          eventId={eventId}
          draw={draw}
          teams={teams}
          tournamentFormat={tournamentFormat ?? 'fours'}
          updateDraw={updateDrawForResults}
          replaceDrawAndPersist={replaceDrawAndPersist}
          saveStatus={saveStatus}
        />
      )}
    </AppPage>
  );
}
