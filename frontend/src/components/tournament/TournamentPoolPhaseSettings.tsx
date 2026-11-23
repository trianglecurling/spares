import { useId } from 'react';
import ChoiceInput from '../ChoiceInput';
import FormCheckbox from '../FormCheckbox';
import FormField from '../FormField';
import FormSection from '../FormSection';
import type { PoolStandingsSettings, TournamentDrawState, TournamentPhase } from '../../utils/tournamentDrawModel';
import { poolSettings } from '../../utils/tournamentDrawPhases';

type UpdateDraw = (fn: (d: TournamentDrawState) => TournamentDrawState, opts?: { markDirty?: boolean }) => void;

type TournamentPoolPhaseSettingsProps = {
  draw: TournamentDrawState;
  phaseId: string;
  updateDraw: UpdateDraw;
};

function patchPhase(d: TournamentDrawState, phaseId: string, patch: Partial<TournamentPhase>): TournamentDrawState {
  return { ...d, phases: d.phases.map((p) => (p.id === phaseId ? { ...p, ...patch } : p)) };
}

function parseIntInRange(raw: string, min: number, max: number): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export default function TournamentPoolPhaseSettings({
  draw,
  phaseId,
  updateDraw,
}: TournamentPoolPhaseSettingsProps) {
  const phase = draw.phases.find((p) => p.id === phaseId);
  const settings = poolSettings(phase);
  if (!phase) return null;

  const setSettings = (patch: Partial<PoolStandingsSettings>) =>
    updateDraw((d) => {
      const current = poolSettings(d.phases.find((p) => p.id === phaseId));
      return patchPhase(d, phaseId, { standings: { ...current, ...patch } });
    });

  return <StandingsSettingsSection settings={settings} onChange={setSettings} />;
}

function StandingsSettingsSection({
  settings,
  onChange,
}: {
  settings: PoolStandingsSettings;
  onChange: (patch: Partial<PoolStandingsSettings>) => void;
}) {
  const pointsId = useId();
  const rankById = useId();
  const tiebreakId = useId();
  return (
    <FormSection title="Standings" surface="panel">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Points possible per game" htmlFor={pointsId} helperText="1 = win/loss, 2 = 2-1-0">
            <input
              id={pointsId}
              type="number"
              min={1}
              max={100}
              className="app-input w-full"
              value={settings.pointsPossiblePerGame}
              onChange={(e) => {
                const n = parseIntInRange(e.target.value, 1, 100);
                if (n != null) onChange({ pointsPossiblePerGame: n });
              }}
            />
          </FormField>
          <FormField label="Rank by" htmlFor={rankById}>
            <ChoiceInput<string>
              inputId={rankById}
              listboxLabel="Rank by"
              options={[
                { value: 'points', label: 'Points' },
                { value: 'percentage', label: 'Percentage of points possible' },
              ]}
              value={settings.rankBy}
              onChange={(v) => {
                if (v === 'points' || v === 'percentage') onChange({ rankBy: v });
              }}
            />
          </FormField>
        </div>
        <FormCheckbox
          label="Head-to-head breaks two-way ties"
          checked={settings.headToHead}
          onChange={(headToHead) => onChange({ headToHead })}
        />
        <FormField label="Tiebreak name" htmlFor={tiebreakId} helperText="Entered per game and summed (e.g. LSD).">
          <input
            id={tiebreakId}
            className="app-input w-full"
            value={settings.tiebreakLabel}
            maxLength={40}
            onChange={(e) => onChange({ tiebreakLabel: e.target.value })}
            onBlur={(e) => {
              if (!e.target.value.trim()) onChange({ tiebreakLabel: 'Tiebreak' });
            }}
          />
        </FormField>
        <FormCheckbox
          label="Lower tiebreak is better"
          checked={settings.tiebreakLowerIsBetter}
          onChange={(tiebreakLowerIsBetter) => onChange({ tiebreakLowerIsBetter })}
        />
      </div>
    </FormSection>
  );
}
