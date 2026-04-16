import { FormEvent, useEffect, useMemo, useState } from 'react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import Modal from '../../components/Modal';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import {
  defaultViceSkip,
  DOUBLES_SLOTS,
  FOURS_TABLE_SLOTS,
  rosterSlotsForFormat,
  slotLabel,
  type TournamentFormat,
} from '../../utils/tournamentDisplay';

export type TournamentRosterSlotApi = {
  slotCode: string;
  playerName: string | null;
  email: string | null;
  notes: string | null;
};

export type TournamentTeamApi = {
  id: number;
  sortOrder: number;
  teamName: string | null;
  homeClub: string | null;
  viceSlotCode: string;
  skipSlotCode: string;
  roster: TournamentRosterSlotApi[];
};

type RosterFieldRow = { playerName: string; email: string; notes: string };

type AdminEventTournamentTeamModalProps = {
  isOpen: boolean;
  onClose: () => void;
  eventId: number;
  format: TournamentFormat;
  team: TournamentTeamApi | null;
  onSaved: () => void;
};

function emptyRosterFields(format: TournamentFormat): Record<string, RosterFieldRow> {
  return Object.fromEntries(
    rosterSlotsForFormat(format).map((code) => [code, { playerName: '', email: '', notes: '' }]),
  );
}

export default function AdminEventTournamentTeamModal({
  isOpen,
  onClose,
  eventId,
  format,
  team,
  onSaved,
}: AdminEventTournamentTeamModalProps) {
  const { showAlert } = useAlert();
  const viceRadioName = `tournament-team-vice-${eventId}`;
  const skipRadioName = `tournament-team-skip-${eventId}`;
  const [teamName, setTeamName] = useState('');
  const [homeClub, setHomeClub] = useState('');
  const [viceSlotCode, setViceSlotCode] = useState('');
  const [skipSlotCode, setSkipSlotCode] = useState('');
  const [rosterFields, setRosterFields] = useState<Record<string, RosterFieldRow>>(() => emptyRosterFields(format));
  const [saving, setSaving] = useState(false);

  const eligibleViceSkipSlots = useMemo((): string[] => {
    return format === 'fours' ? [...FOURS_TABLE_SLOTS] : [...DOUBLES_SLOTS];
  }, [format]);

  useEffect(() => {
    if (!isOpen) return;
    const defs = defaultViceSkip(format);
    if (team) {
      setTeamName(team.teamName ?? '');
      setHomeClub(team.homeClub ?? '');
      setViceSlotCode(team.viceSlotCode);
      setSkipSlotCode(team.skipSlotCode);
      const bySlot = new Map(team.roster.map((r) => [r.slotCode, r]));
      const next: Record<string, RosterFieldRow> = {};
      for (const code of rosterSlotsForFormat(format)) {
        const r = bySlot.get(code);
        next[code] = {
          playerName: r?.playerName ?? '',
          email: r?.email ?? '',
          notes: r?.notes ?? '',
        };
      }
      setRosterFields(next);
    } else {
      setTeamName('');
      setHomeClub('');
      setViceSlotCode(defs.vice);
      setSkipSlotCode(defs.skip);
      setRosterFields(emptyRosterFields(format));
    }
  }, [isOpen, team, format]);

  const pickOtherSlot = (excluded: string, preferred: string): string => {
    if (preferred !== excluded) return preferred;
    return eligibleViceSkipSlots.find((s) => s !== excluded) ?? excluded;
  };

  const setViceSafely = (code: string) => {
    setViceSlotCode(code);
    setSkipSlotCode((prevSkip) => {
      if (prevSkip !== code) return prevSkip;
      const def = defaultViceSkip(format);
      return pickOtherSlot(code, def.skip);
    });
  };

  const setSkipSafely = (code: string) => {
    setSkipSlotCode(code);
    setViceSlotCode((prevVice) => {
      if (prevVice !== code) return prevVice;
      const def = defaultViceSkip(format);
      return pickOtherSlot(code, def.vice);
    });
  };

  const updateRoster = (code: string, patch: Partial<RosterFieldRow>) => {
    setRosterFields((prev) => ({
      ...prev,
      [code]: { ...prev[code], ...patch },
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (viceSlotCode === skipSlotCode) {
      showAlert('Vice and skip must be different positions', 'error');
      return;
    }
    setSaving(true);
    try {
      const roster = rosterSlotsForFormat(format).map((slotCode) => {
        const row = rosterFields[slotCode] ?? { playerName: '', email: '', notes: '' };
        return {
          slotCode,
          playerName: row.playerName.trim() || null,
          email: row.email.trim() || null,
          notes: row.notes.trim() || null,
        };
      });
      const body = {
        teamName: teamName.trim() || null,
        homeClub: homeClub.trim() || null,
        viceSlotCode,
        skipSlotCode,
        roster,
      };
      if (team) {
        await api.patch(`/events/${eventId}/tournament-teams/${team.id}`, body);
        showAlert('Team updated', 'success');
      } else {
        await api.post(`/events/${eventId}/tournament-teams`, body);
        showAlert('Team added', 'success');
      }
      onSaved();
      onClose();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save team'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const radioClass =
    'h-4 w-4 shrink-0 border-gray-300 text-primary-teal focus:ring-primary-teal dark:border-gray-600 dark:bg-gray-800';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={team ? 'Edit team' : 'Add team'}
      size="xl"
      verticalAlign="start"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormSection title="Team" surface="plain" className="!space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Team name" htmlFor="tournament-team-name">
              <input
                id="tournament-team-name"
                type="text"
                value={teamName}
                onChange={(ev) => setTeamName(ev.target.value)}
                className="app-input"
                maxLength={200}
              />
            </FormField>
            <FormField label="Home club" htmlFor="tournament-team-club">
              <input
                id="tournament-team-club"
                type="text"
                value={homeClub}
                onChange={(ev) => setHomeClub(ev.target.value)}
                className="app-input"
                maxLength={200}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Roster" surface="plain" className="!space-y-3">
          <div className="space-y-3">
            {rosterSlotsForFormat(format).map((code) => {
              const row = rosterFields[code] ?? { playerName: '', email: '', notes: '' };
              const baseId = `roster-${code}`;
              const showViceSkip = eligibleViceSkipSlots.includes(code);
              const positionLabel = slotLabel(format, code);
              return (
                <div
                  key={code}
                  className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {positionLabel}
                    </span>
                    {showViceSkip ? (
                      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                        <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                          <input
                            type="radio"
                            name={viceRadioName}
                            className={radioClass}
                            checked={viceSlotCode === code}
                            onChange={() => setViceSafely(code)}
                          />
                          Vice
                        </label>
                        <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                          <input
                            type="radio"
                            name={skipRadioName}
                            className={radioClass}
                            checked={skipSlotCode === code}
                            onChange={() => setSkipSafely(code)}
                          />
                          Skip
                        </label>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FormField label="Name" htmlFor={`${baseId}-name`}>
                      <input
                        id={`${baseId}-name`}
                        type="text"
                        value={row.playerName}
                        onChange={(ev) => updateRoster(code, { playerName: ev.target.value })}
                        className="app-input"
                        maxLength={200}
                      />
                    </FormField>
                    <FormField label="Email" htmlFor={`${baseId}-email`}>
                      <input
                        id={`${baseId}-email`}
                        type="email"
                        inputMode="email"
                        autoComplete="off"
                        value={row.email}
                        onChange={(ev) => updateRoster(code, { email: ev.target.value })}
                        className="app-input"
                        maxLength={320}
                      />
                    </FormField>
                    <FormField label="Notes" htmlFor={`${baseId}-notes`}>
                      <input
                        id={`${baseId}-notes`}
                        type="text"
                        value={row.notes}
                        onChange={(ev) => updateRoster(code, { notes: ev.target.value })}
                        className="app-input"
                        maxLength={2000}
                      />
                    </FormField>
                  </div>
                </div>
              );
            })}
          </div>
        </FormSection>

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : team ? 'Save team' : 'Add team'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
