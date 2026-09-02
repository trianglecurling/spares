import {
  guaranteeChipClassName,
  rosterGuaranteeChipLabel,
  shouldShowGuaranteeChip,
  type LeaguePriorityGuaranteeLabel,
} from '../../components/registration/leaguePriorityShared';

type RosterGuaranteeChipLeague = {
  isPlayInBased?: boolean;
  leagueType?: 'standard' | 'bring_your_own_team';
  format?: 'teams' | 'doubles' | 'instructional';
};

export function RosterGuaranteeChip({
  guaranteeLabel,
  priorityRank,
  league,
}: {
  guaranteeLabel: LeaguePriorityGuaranteeLabel | null | undefined;
  priorityRank?: number | null;
  league?: RosterGuaranteeChipLeague | null;
}) {
  if (!shouldShowGuaranteeChip(guaranteeLabel)) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${guaranteeChipClassName(guaranteeLabel)}`}>
      {rosterGuaranteeChipLabel(guaranteeLabel, priorityRank, league ?? undefined)}
    </span>
  );
}
