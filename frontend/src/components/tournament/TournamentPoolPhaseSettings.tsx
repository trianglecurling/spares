import { useId, useMemo } from 'react';
import { HiTrash } from 'react-icons/hi2';
import Button from '../Button';
import ChoiceInput, { type ChoiceOption } from '../ChoiceInput';
import FormCheckbox from '../FormCheckbox';
import FormField from '../FormField';
import FormSection from '../FormSection';
import InlineStateMessage from '../InlineStateMessage';
import type { TournamentTeamApi } from '../../types/tournamentTeam';
import { formatTeamDisplayName } from '../../utils/tournamentDisplay';
import type {
  AdvancingStep,
  PoolStandingsSettings,
  TournamentDrawState,
  TournamentPhase,
} from '../../utils/tournamentDrawModel';
import {
  computeAdvancingSeeds,
  poolSettings,
  poolsForPhase,
  type AdvancingSeed,
} from '../../utils/tournamentDrawPhases';

type UpdateDraw = (fn: (d: TournamentDrawState) => TournamentDrawState, opts?: { markDirty?: boolean }) => void;

type TournamentPoolPhaseSettingsProps = {
  draw: TournamentDrawState;
  phaseId: string;
  teamsById: Map<number, TournamentTeamApi>;
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
  teamsById,
  updateDraw,
}: TournamentPoolPhaseSettingsProps) {
  const phase = draw.phases.find((p) => p.id === phaseId);
  const settings = poolSettings(phase);
  const steps = phase?.advancing ?? [];
  if (!phase) return null;

  const setSettings = (patch: Partial<PoolStandingsSettings>) =>
    updateDraw((d) => {
      const current = poolSettings(d.phases.find((p) => p.id === phaseId));
      return patchPhase(d, phaseId, { standings: { ...current, ...patch } });
    });
  const setSteps = (fn: (steps: AdvancingStep[]) => AdvancingStep[]) =>
    updateDraw((d) => {
      const current = d.phases.find((p) => p.id === phaseId)?.advancing ?? [];
      return patchPhase(d, phaseId, { advancing: fn(current) });
    });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <StandingsSettingsSection settings={settings} onChange={setSettings} />
      <AdvancingSection draw={draw} phaseId={phaseId} steps={steps} teamsById={teamsById} setSteps={setSteps} />
    </div>
  );
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

const STEP_KIND_OPTIONS: ChoiceOption<string>[] = [
  { value: 'top_per_pool', label: 'Top teams in each pool' },
  { value: 'pool_place', label: 'A specific pool finish' },
  { value: 'best_remaining', label: 'Best remaining teams' },
];

function AdvancingSection({
  draw,
  phaseId,
  steps,
  teamsById,
  setSteps,
}: {
  draw: TournamentDrawState;
  phaseId: string;
  steps: AdvancingStep[];
  teamsById: Map<number, TournamentTeamApi>;
  setSteps: (fn: (steps: AdvancingStep[]) => AdvancingStep[]) => void;
}) {
  const baseId = useId();
  const pools = poolsForPhase(draw, phaseId);
  const seeds = useMemo(() => computeAdvancingSeeds(draw, phaseId) ?? [], [draw, phaseId]);
  const poolOptions: ChoiceOption<string>[] = pools.map((p) => ({ value: p.id, label: p.name }));

  const replaceStep = (id: string, next: AdvancingStep) =>
    setSteps((list) => list.map((s) => (s.id === id ? next : s)));

  const changeKind = (step: AdvancingStep, kind: string) => {
    if (kind === step.kind) return;
    if (kind === 'pool_place') {
      replaceStep(step.id, { id: step.id, kind, poolId: pools[0]?.id ?? '', rank: 1 });
    } else if (kind === 'top_per_pool' || kind === 'best_remaining') {
      replaceStep(step.id, { id: step.id, kind, count: 1 });
    }
  };

  return (
    <FormSection title="Advancing teams" surface="panel">
      <div className="space-y-4">
        {steps.length === 0 ? (
          <InlineStateMessage title="No advancing teams" description="Add a step to seed the next phase." />
        ) : (
          <ol className="space-y-3">
            {steps.map((step, i) => {
              const kindId = `${baseId}-${step.id}-kind`;
              const countId = `${baseId}-${step.id}-count`;
              const poolId = `${baseId}-${step.id}-pool`;
              return (
                <li
                  key={step.id}
                  className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-600"
                >
                  <FormField label={`Step ${i + 1}`} htmlFor={kindId} className="min-w-[12rem] flex-1">
                    <ChoiceInput<string>
                      inputId={kindId}
                      listboxLabel={`Step ${i + 1}`}
                      options={STEP_KIND_OPTIONS}
                      value={step.kind}
                      onChange={(v) => {
                        if (typeof v === 'string') changeKind(step, v);
                      }}
                    />
                  </FormField>
                  {step.kind === 'pool_place' ? (
                    <>
                      <FormField label="Pool" htmlFor={poolId} className="min-w-[8rem]">
                        <ChoiceInput<string>
                          inputId={poolId}
                          listboxLabel="Pool"
                          options={poolOptions}
                          value={step.poolId || null}
                          placeholder="Choose a pool"
                          onChange={(v) => {
                            if (typeof v === 'string') replaceStep(step.id, { ...step, poolId: v });
                          }}
                        />
                      </FormField>
                      <FormField label="Place" htmlFor={countId} className="w-20">
                        <input
                          id={countId}
                          type="number"
                          min={1}
                          className="app-input w-full"
                          value={step.rank}
                          onChange={(e) => {
                            const rank = parseIntInRange(e.target.value, 1, 64);
                            if (rank != null) replaceStep(step.id, { ...step, rank });
                          }}
                        />
                      </FormField>
                    </>
                  ) : (
                    <FormField label="How many" htmlFor={countId} className="w-24">
                      <input
                        id={countId}
                        type="number"
                        min={1}
                        className="app-input w-full"
                        value={step.count}
                        onChange={(e) => {
                          const count = parseIntInRange(e.target.value, 1, 256);
                          if (count != null) replaceStep(step.id, { ...step, count });
                        }}
                      />
                    </FormField>
                  )}
                  <Button
                    type="button"
                    variant="outline-danger"
                    className="mb-0.5 h-10 w-10 shrink-0 !p-0"
                    aria-label={`Remove step ${i + 1}`}
                    title="Remove step"
                    onClick={() => setSteps((list) => list.filter((s) => s.id !== step.id))}
                  >
                    <HiTrash className="h-5 w-5" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setSteps((list) => [
              ...list,
              list.length === 0
                ? { id: crypto.randomUUID(), kind: 'top_per_pool', count: 1 }
                : { id: crypto.randomUUID(), kind: 'best_remaining', count: 1 },
            ])
          }
        >
          Add step
        </Button>
        {seeds.length > 0 ? (
          <div>
            <h3 className="app-label">Seeds</h3>
            <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-600">
              {seeds.map((seed) => (
                <li key={seed.seed} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                  <span className="w-8 shrink-0 font-mono font-semibold text-gray-900 dark:text-gray-100">
                    Q{seed.seed}
                  </span>
                  <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-300">{seed.description}</span>
                  <SeedHolder seed={seed} teamsById={teamsById} />
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </FormSection>
  );
}

function teamName(teamsById: Map<number, TournamentTeamApi>, id: number): string {
  const t = teamsById.get(id);
  return t ? formatTeamDisplayName(t.teamName, t.sortOrder) : `Team #${id}`;
}

export function SeedHolder({ seed, teamsById }: { seed: AdvancingSeed; teamsById: Map<number, TournamentTeamApi> }) {
  if (seed.registrationId != null) {
    return <span className="font-medium text-gray-900 dark:text-gray-100">{teamName(teamsById, seed.registrationId)}</span>;
  }
  if (seed.tiedRegistrationIds.length > 1) {
    return (
      <span className="text-amber-800 dark:text-amber-300">
        Tied: {seed.tiedRegistrationIds.map((id) => teamName(teamsById, id)).join(', ')}
      </span>
    );
  }
  if (seed.projectedRegistrationId != null) {
    return (
      <span className="text-gray-500 dark:text-gray-400">
        {teamName(teamsById, seed.projectedRegistrationId)} (so far)
      </span>
    );
  }
  return <span className="text-gray-400 dark:text-gray-500">TBD</span>;
}
