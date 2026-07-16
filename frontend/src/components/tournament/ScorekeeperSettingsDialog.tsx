import { useEffect, useId, useState } from 'react';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import Modal from '../Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import type {
  TournamentDrawState,
  TournamentResultType,
  TournamentRockColorMode,
} from '../../utils/tournamentDrawModel';
import { countGamesWithResults } from '../../utils/tournamentDrawResultsRows';
import { countGamesWithRockColors } from '../../utils/tournamentRockColors';
import {
  resultTypeLabel,
  summarizeResultTypeChange,
  TOURNAMENT_RESULT_TYPE_OPTIONS,
} from '../../utils/tournamentResultType';

const ROCK_COLOR_MODE_OPTIONS: Array<{
  value: TournamentRockColorMode;
  label: string;
  description: string;
}> = [
  {
    value: 'manual',
    label: 'Manual',
    description: 'Assign rock colors per game from the scorekeeper, or leave unset.',
  },
  {
    value: 'randomized',
    label: 'Randomized',
    description:
      'Automatically assign sheet rock colors to games that do not already have colors.',
  },
];

export type ScorekeeperSettingsConfirm = {
  resultType: TournamentResultType;
  rockColorMode: TournamentRockColorMode;
};

type ScorekeeperSettingsDialogProps = {
  open: boolean;
  currentResultType: TournamentResultType;
  currentRockColorMode: TournamentRockColorMode;
  draw: TournamentDrawState;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (next: ScorekeeperSettingsConfirm) => void;
  onResetAllScores: () => Promise<void>;
  onResetAllColors: () => Promise<void>;
};

export default function ScorekeeperSettingsDialog({
  open,
  currentResultType,
  currentRockColorMode,
  draw,
  saving = false,
  onClose,
  onConfirm,
  onResetAllScores,
  onResetAllColors,
}: ScorekeeperSettingsDialogProps) {
  const { confirm } = useConfirm();
  const resultTypeId = useId();
  const rockColorModeId = useId();
  const [selectedResultType, setSelectedResultType] =
    useState<TournamentResultType>(currentResultType);
  const [selectedRockColorMode, setSelectedRockColorMode] =
    useState<TournamentRockColorMode>(currentRockColorMode);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedResultType(currentResultType);
      setSelectedRockColorMode(currentRockColorMode);
      setResetting(false);
    }
  }, [open, currentResultType, currentRockColorMode]);

  const summary =
    selectedResultType === currentResultType
      ? null
      : summarizeResultTypeChange(draw, selectedResultType);
  const hasImpact = summary != null && (summary.cleared > 0 || summary.keptOrConverted > 0);
  const losesDetail =
    (currentResultType === 'ends' &&
      (selectedResultType === 'score' || selectedResultType === 'pick')) ||
    (currentResultType === 'score' && selectedResultType === 'pick');
  const clearsResults =
    (currentResultType === 'pick' &&
      (selectedResultType === 'score' || selectedResultType === 'ends')) ||
    (currentResultType === 'score' && selectedResultType === 'ends');

  const unchanged =
    selectedResultType === currentResultType && selectedRockColorMode === currentRockColorMode;
  const busy = saving || resetting;
  const gamesWithResults = countGamesWithResults(draw);
  const gamesWithColors = countGamesWithRockColors(draw);

  const handleResetScores = async () => {
    const ok = await confirm({
      title: 'Reset all scores?',
      message: `This clears recorded results from ${gamesWithResults} game${gamesWithResults === 1 ? '' : 's'}. This cannot be undone.`,
      confirmText: 'Reset scores',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!ok) return;
    setResetting(true);
    try {
      await onResetAllScores();
    } finally {
      setResetting(false);
    }
  };

  const handleResetColors = async () => {
    const ok = await confirm({
      title: 'Reset all colors?',
      message: `This clears rock color assignments from ${gamesWithColors} game${gamesWithColors === 1 ? '' : 's'}. This cannot be undone.`,
      confirmText: 'Reset colors',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!ok) return;
    setResetting(true);
    try {
      await onResetAllColors();
    } finally {
      setResetting(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={busy ? () => undefined : onClose}
      title="Scorekeeping settings"
      size="md"
      verticalAlign="start"
    >
      <div className="space-y-5">
        <div>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Choose how results are recorded for all two-sided games in this event. Competitions with
            three or more teams always use per-competitor scores.
          </p>
          <FormField label="Result type" htmlFor={resultTypeId}>
            <ChoiceInput<TournamentResultType>
              inputId={resultTypeId}
              listboxLabel="Result type"
              layout="block"
              options={TOURNAMENT_RESULT_TYPE_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                description: o.description,
              }))}
              value={selectedResultType}
              onChange={(v) => {
                if (v == null || Array.isArray(v)) return;
                setSelectedResultType(v);
              }}
            />
          </FormField>

          {hasImpact && summary ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              {clearsResults && summary.cleared > 0 ? (
                <p>
                  Switching from {resultTypeLabel(currentResultType)} to{' '}
                  {resultTypeLabel(selectedResultType)} clears {summary.cleared} existing two-sided
                  result{summary.cleared === 1 ? '' : 's'} so those games need a result again.
                </p>
              ) : losesDetail && (summary.keptOrConverted > 0 || summary.cleared > 0) ? (
                <p>
                  {summary.keptOrConverted > 0
                    ? `Completed games will be converted to ${resultTypeLabel(selectedResultType).toLowerCase()} (${summary.keptOrConverted} game${summary.keptOrConverted === 1 ? '' : 's'}).`
                    : null}
                  {summary.cleared > 0
                    ? ` ${summary.cleared} game${summary.cleared === 1 ? '' : 's'} without enough detail will need a new result.`
                    : null}
                  {currentResultType === 'ends' && summary.keptOrConverted > 0
                    ? ' End-by-end detail will no longer be kept.'
                    : null}
                </p>
              ) : summary.cleared > 0 ? (
                <p>
                  {summary.cleared} game{summary.cleared === 1 ? '' : 's'} will need a new result.
                </p>
              ) : (
                <p>
                  {summary.keptOrConverted} game{summary.keptOrConverted === 1 ? '' : 's'} will be
                  updated for {resultTypeLabel(selectedResultType).toLowerCase()}.
                </p>
              )}
            </div>
          ) : null}

          <div className="mt-3">
            <Button
              type="button"
              variant="outline-danger"
              disabled={busy || gamesWithResults === 0}
              onClick={() => void handleResetScores()}
            >
              Reset all scores
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Rock colors come from each game’s sheet settings. Manual lets you assign or unset per
            game; randomized fills games that still have no colors.
          </p>
          <FormField label="Rock colors" htmlFor={rockColorModeId}>
            <ChoiceInput<TournamentRockColorMode>
              inputId={rockColorModeId}
              listboxLabel="Rock colors"
              layout="block"
              options={ROCK_COLOR_MODE_OPTIONS}
              value={selectedRockColorMode}
              onChange={(v) => {
                if (v == null || Array.isArray(v)) return;
                setSelectedRockColorMode(v);
              }}
            />
          </FormField>

          <div className="mt-3">
            <Button
              type="button"
              variant="outline-danger"
              disabled={busy || gamesWithColors === 0}
              onClick={() => void handleResetColors()}
            >
              Reset all colors
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={busy || unchanged}
          onClick={() =>
            onConfirm({
              resultType: selectedResultType,
              rockColorMode: selectedRockColorMode,
            })
          }
        >
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </Modal>
  );
}
