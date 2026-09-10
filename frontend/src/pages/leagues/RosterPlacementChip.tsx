import type { RosterPlacementSource } from '../../../../backend/src/registration/rosterPlacementSource';

const PLACEMENT_SOURCE_LABEL: Record<RosterPlacementSource, string> = {
  league_returner: 'League returner',
  waitlist_add: 'Waitlist add',
  third_league: 'Third-league',
};

const PLACEMENT_SOURCE_CLASS: Record<RosterPlacementSource, string> = {
  league_returner: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
  waitlist_add: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  third_league: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200',
};

const TEMPORARY_FILL_CLASS =
  'bg-teal-100 text-teal-900 dark:bg-teal-900/30 dark:text-teal-200';

export function RosterPlacementChips({
  placementSource,
  isTemporarySabbaticalFill,
}: {
  placementSource?: RosterPlacementSource | null;
  isTemporarySabbaticalFill?: boolean;
}) {
  if (!placementSource && !isTemporarySabbaticalFill) return null;
  return (
    <>
      {placementSource ? (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLACEMENT_SOURCE_CLASS[placementSource]}`}>
          {PLACEMENT_SOURCE_LABEL[placementSource]}
        </span>
      ) : null}
      {isTemporarySabbaticalFill ? (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TEMPORARY_FILL_CLASS}`}>
          Temporary fill
        </span>
      ) : null}
    </>
  );
}
