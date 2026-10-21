import { useEffect, useId, useMemo, useState } from 'react';
import Button from '../Button';
import ChoiceInput, { type ChoiceOption } from '../ChoiceInput';
import FormField from '../FormField';
import Modal from '../Modal';
import type { TournamentDrawState, TournamentSlotSource } from '../../utils/tournamentDrawModel';
import { earlierPhases, poolsForPhase } from '../../utils/tournamentDrawPhases';
import { formatDrawBlockOptionLabel } from '../../utils/tournamentDrawSchedule';

type StandingSource = Extract<TournamentSlotSource, { sourceType: 'standing' }>;

type CustomStandingDialogProps = {
  isOpen: boolean;
  draw: TournamentDrawState;
  /** Phase of the slot being edited. */
  contextPhaseId: string;
  /** Pool games may use their own phase's standings after a given draw. */
  allowSamePhase: boolean;
  initial?: StandingSource | null;
  onCancel: () => void;
  onConfirm: (source: StandingSource) => void;
};

const END_OF_PHASE = '__end';
const OVERALL = '__overall';
const RANKED_POOL = '__ranked';

export default function CustomStandingDialog({
  isOpen,
  draw,
  contextPhaseId,
  allowSamePhase,
  initial,
  onCancel,
  onConfirm,
}: CustomStandingDialogProps) {
  const phaseFieldId = useId();
  const rankingFieldId = useId();
  const poolRankFieldId = useId();
  const placeFieldId = useId();
  const asOfFieldId = useId();

  const eligiblePhases = useMemo(() => {
    const list = earlierPhases(draw, contextPhaseId).filter((p) => p.kind === 'pool');
    const self = draw.phases.find((p) => p.id === contextPhaseId);
    if (allowSamePhase && self?.kind === 'pool') list.push(self);
    return list;
  }, [draw, contextPhaseId, allowSamePhase]);

  const [phaseId, setPhaseId] = useState('');
  const [ranking, setRanking] = useState(OVERALL);
  const [poolRank, setPoolRank] = useState('1');
  const [place, setPlace] = useState('1');
  const [asOf, setAsOf] = useState(END_OF_PHASE);

  useEffect(() => {
    if (!isOpen) return;
    const fallback = eligiblePhases[eligiblePhases.length - 1]?.id ?? '';
    const pid = initial && eligiblePhases.some((p) => p.id === initial.phaseId) ? initial.phaseId : fallback;
    setPhaseId(pid);
    setRanking(initial?.poolId ? initial.poolId : initial?.poolRank != null ? RANKED_POOL : OVERALL);
    setPoolRank(String(initial?.poolRank ?? 1));
    setPlace(String(initial?.rank ?? 1));
    setAsOf(initial?.afterDrawBlockId ?? END_OF_PHASE);
  }, [isOpen, initial, eligiblePhases]);

  const samePhase = phaseId === contextPhaseId;
  const pools = useMemo(() => poolsForPhase(draw, phaseId), [draw, phaseId]);

  const phaseOptions: ChoiceOption<string>[] = eligiblePhases.map((p) => ({
    value: p.id,
    label: p.id === contextPhaseId ? `${p.name} (this phase)` : p.name,
  }));
  const rankingOptions: ChoiceOption<string>[] = [
    ...pools.map((p) => ({ value: p.id, label: p.name })),
    { value: RANKED_POOL, label: 'Ranked pool (by top team)' },
    { value: OVERALL, label: 'Overall (all pools)' },
  ];
  const asOfOptions: ChoiceOption<string>[] = [
    ...(samePhase ? [] : [{ value: END_OF_PHASE, label: 'End of phase' }]),
    ...[...draw.drawBlocks]
      .sort((a, b) => a.order - b.order)
      .map((b) => ({ value: b.id, label: `After ${formatDrawBlockOptionLabel(b)}` })),
  ];

  const placeNum = Number.parseInt(place, 10);
  const poolRankNum = Number.parseInt(poolRank, 10);
  const needsDraw = samePhase && asOf === END_OF_PHASE;
  const valid =
    !!phaseId &&
    Number.isFinite(placeNum) &&
    placeNum >= 1 &&
    (ranking !== RANKED_POOL || (Number.isFinite(poolRankNum) && poolRankNum >= 1)) &&
    !needsDraw;

  const confirm = () => {
    if (!valid) return;
    onConfirm({
      sourceType: 'standing',
      phaseId,
      poolId: ranking !== OVERALL && ranking !== RANKED_POOL ? ranking : null,
      poolRank: ranking === RANKED_POOL ? poolRankNum : null,
      rank: placeNum,
      afterDrawBlockId: asOf === END_OF_PHASE ? null : asOf,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Custom standing" size="md">
      <div className="space-y-4">
        {eligiblePhases.length > 1 ? (
          <FormField label="Phase" htmlFor={phaseFieldId}>
            <ChoiceInput<string>
              inputId={phaseFieldId}
              listboxLabel="Phase"
              options={phaseOptions}
              value={phaseId}
              onChange={(v) => {
                if (typeof v !== 'string') return;
                setPhaseId(v);
                setRanking(OVERALL);
                if (v === contextPhaseId && asOf === END_OF_PHASE) setAsOf(draw.drawBlocks[0]?.id ?? END_OF_PHASE);
              }}
            />
          </FormField>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Ranking" htmlFor={rankingFieldId}>
            <ChoiceInput<string>
              inputId={rankingFieldId}
              listboxLabel="Ranking"
              options={rankingOptions}
              value={ranking}
              onChange={(v) => {
                if (typeof v === 'string') setRanking(v);
              }}
            />
          </FormField>
          <FormField label="Place" htmlFor={placeFieldId}>
            <input
              id={placeFieldId}
              type="number"
              min={1}
              className="app-input w-full"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
            />
          </FormField>
        </div>
        {ranking === RANKED_POOL ? (
          <FormField label="Pool rank" htmlFor={poolRankFieldId} helperText="1 = the pool with the best top team.">
            <input
              id={poolRankFieldId}
              type="number"
              min={1}
              className="app-input w-full"
              value={poolRank}
              onChange={(e) => setPoolRank(e.target.value)}
            />
          </FormField>
        ) : null}
        <FormField
          label="As of"
          htmlFor={asOfFieldId}
          error={needsDraw ? 'Choose a draw for standings within this phase.' : undefined}
        >
          <ChoiceInput<string>
            inputId={asOfFieldId}
            listboxLabel="As of"
            options={asOfOptions}
            value={asOfOptions.some((o) => o.type !== 'divider' && o.value === asOf) ? asOf : null}
            placeholder="Choose a draw"
            onChange={(v) => {
              if (typeof v === 'string') setAsOf(v);
            }}
          />
        </FormField>
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={confirm} disabled={!valid}>
            Use standing
          </Button>
        </div>
      </div>
    </Modal>
  );
}
