export type TournamentRosterSlotApi = {
  slotCode: string;
  playerName: string | null;
  email: string | null;
  notes: string | null;
  homeClub: string | null;
};

/** Confirmed registration shaped as a tournament team (`id` is registration id). */
export type TournamentTeamApi = {
  id: number;
  sortOrder: number;
  teamName: string | null;
  homeClub: string | null;
  viceSlotCode: string;
  skipSlotCode: string;
  roster: TournamentRosterSlotApi[];
};
