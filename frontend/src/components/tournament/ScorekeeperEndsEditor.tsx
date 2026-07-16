import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { IoHammer } from 'react-icons/io5';
import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import FormFieldMessage from '../FormFieldMessage';
import type { TournamentFormat } from '../../utils/tournamentDisplay';
import {
  eligiblePowerPlayEnds,
  hammerSlotForEnd,
} from '../../utils/tournamentEndsHammer';

export type EndScoreEntry = { side0: number; side1: number };

const MIN_ENDS = 8;
const MAX_POINTS = 8;

function isEndFilled(entry: EndScoreEntry | null | undefined): entry is EndScoreEntry {
  return entry != null;
}

/** Consecutive filled ends from the start. */
export function consecutiveFilledEndCount(entries: Array<EndScoreEntry | null>): number {
  let n = 0;
  for (const entry of entries) {
    if (!isEndFilled(entry)) break;
    n += 1;
  }
  return n;
}

export function visibleEndsLayout(
  entries: Array<EndScoreEntry | null>,
  gameComplete: boolean,
): { columnCount: number; xColumnIndex: number | null } {
  const filled = consecutiveFilledEndCount(entries);
  if (gameComplete) {
    if (filled < MIN_ENDS) {
      return { columnCount: filled + 1, xColumnIndex: filled };
    }
    return { columnCount: Math.max(filled, 1), xColumnIndex: null };
  }
  if (filled >= MIN_ENDS) {
    return { columnCount: filled + 1, xColumnIndex: null };
  }
  return { columnCount: MIN_ENDS, xColumnIndex: null };
}

export function endsArraysFromEntries(entries: Array<EndScoreEntry | null>): {
  side0: number[];
  side1: number[];
} | null {
  const filled = consecutiveFilledEndCount(entries);
  if (filled === 0) return null;
  const side0: number[] = [];
  const side1: number[] = [];
  for (let i = 0; i < filled; i++) {
    const e = entries[i]!;
    side0.push(e.side0);
    side1.push(e.side1);
  }
  return { side0, side1 };
}

export function entriesFromEndsArrays(side0: number[], side1: number[]): Array<EndScoreEntry | null> {
  const n = Math.min(side0.length, side1.length);
  return Array.from({ length: n }, (_, i) => ({ side0: side0[i]!, side1: side1[i]! }));
}

type ScorekeeperEndsEditorProps = {
  team0Label: string;
  team1Label: string;
  entries: Array<EndScoreEntry | null>;
  gameComplete: boolean;
  tournamentFormat: TournamentFormat;
  firstEndHammerSlot: 0 | 1 | null;
  powerPlayEndSide0: number | null;
  powerPlayEndSide1: number | null;
  disabled?: boolean;
  /** Content before the team name (rock color swatch / control). */
  team0Leading?: ReactNode;
  team1Leading?: ReactNode;
  onChangeEntries: (next: Array<EndScoreEntry | null>) => void;
  onGameCompleteChange: (complete: boolean) => void;
  onFirstEndHammerChange: (slot: 0 | 1 | null) => void;
  onPowerPlayEndChange: (slot: 0 | 1, endNumber: number | null) => void;
};

export default function ScorekeeperEndsEditor({
  team0Label,
  team1Label,
  entries,
  gameComplete,
  tournamentFormat,
  firstEndHammerSlot,
  powerPlayEndSide0,
  powerPlayEndSide1,
  disabled = false,
  team0Leading,
  team1Leading,
  onChangeEntries,
  onGameCompleteChange,
  onFirstEndHammerChange,
  onPowerPlayEndChange,
}: ScorekeeperEndsEditorProps) {
  const pp0Id = useId();
  const pp1Id = useId();
  const gameCompleteSwitchId = useId();
  const isDoubles = tournamentFormat === 'doubles';
  const { columnCount, xColumnIndex } = visibleEndsLayout(entries, gameComplete);
  const filled = consecutiveFilledEndCount(entries);
  const gameCompleteDisabled = disabled || filled === 0;
  const total0 = entries.slice(0, filled).reduce((sum, e) => sum + (e?.side0 ?? 0), 0);
  const total1 = entries.slice(0, filled).reduce((sum, e) => sum + (e?.side1 ?? 0), 0);
  const nextUnplayedEndIndex =
    !gameComplete && xColumnIndex !== filled ? filled : null;
  const nextEndHammerSlot =
    nextUnplayedEndIndex != null && firstEndHammerSlot != null
      ? hammerSlotForEnd(nextUnplayedEndIndex, firstEndHammerSlot, entries, tournamentFormat)
      : null;
  const [openEndIndex, setOpenEndIndex] = useState<number | null>(null);
  const openAnchorRef = useRef<HTMLButtonElement | null>(null);
  const hammerEditable = !disabled && !gameComplete;
  /** Which team's hammer hit-target is hovered (for graying the other team's set icon). */
  const [hammerHoverSlot, setHammerHoverSlot] = useState<0 | 1 | null>(null);

  const pp0Options = [
    { value: 'none' as const, label: 'Not used' },
    ...eligiblePowerPlayEnds(0, firstEndHammerSlot, entries, tournamentFormat).map((n) => ({
      value: String(n) as string,
      label: `End ${n}`,
    })),
  ];
  const pp1Options = [
    { value: 'none' as const, label: 'Not used' },
    ...eligiblePowerPlayEnds(1, firstEndHammerSlot, entries, tournamentFormat).map((n) => ({
      value: String(n) as string,
      label: `End ${n}`,
    })),
  ];

  const pp0Value =
    powerPlayEndSide0 == null ? 'none' : String(powerPlayEndSide0);
  const pp1Value =
    powerPlayEndSide1 == null ? 'none' : String(powerPlayEndSide1);

  const setEnd = (index: number, value: EndScoreEntry | null) => {
    const next = [...entries];
    while (next.length <= index) next.push(null);
    next[index] = value;
    if (value == null) {
      for (let i = index + 1; i < next.length; i++) next[i] = null;
    }
    onChangeEntries(next);
  };

  return (
    <div className="mt-4 space-y-3" onClick={(e) => e.stopPropagation()}>
      {isDoubles ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={`Power play — ${team0Label}`} htmlFor={pp0Id}>
            <ChoiceInput<string>
              inputId={pp0Id}
              listboxLabel={`Power play — ${team0Label}`}
              layout="popover"
              options={pp0Options}
              value={pp0Value}
              disabled={disabled || gameComplete || firstEndHammerSlot == null}
              onChange={(v) => {
                if (v == null || Array.isArray(v)) return;
                onPowerPlayEndChange(0, v === 'none' ? null : Number.parseInt(v, 10));
              }}
            />
          </FormField>
          <FormField label={`Power play — ${team1Label}`} htmlFor={pp1Id}>
            <ChoiceInput<string>
              inputId={pp1Id}
              listboxLabel={`Power play — ${team1Label}`}
              layout="popover"
              options={pp1Options}
              value={pp1Value}
              disabled={disabled || gameComplete || firstEndHammerSlot == null}
              onChange={(v) => {
                if (v == null || Array.isArray(v)) return;
                onPowerPlayEndChange(1, v === 'none' ? null : Number.parseInt(v, 10));
              }}
            />
          </FormField>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/60">
              <th className="sticky left-0 z-[1] bg-gray-50 px-2 py-2 text-left font-medium text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
                End
              </th>
              {Array.from({ length: columnCount }, (_, i) => (
                <th
                  key={i}
                  className="min-w-[2.75rem] px-1 py-2 text-center font-medium tabular-nums text-gray-700 dark:text-gray-200"
                >
                  {i + 1}
                </th>
              ))}
              <th className="min-w-[3rem] px-2 py-2 text-center font-semibold text-gray-900 dark:text-gray-100">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-200 dark:border-gray-700">
              <th className="group/lsfe sticky left-0 z-[1] bg-white px-2 py-1.5 text-left font-medium text-gray-800 dark:bg-gray-900 dark:text-gray-100">
                <TeamNameWithHammer
                  label={team0Label}
                  leading={team0Leading}
                  hasHammer={firstEndHammerSlot === 0}
                  canSetHammer={hammerEditable && firstEndHammerSlot !== 0}
                  canClearHammer={hammerEditable && firstEndHammerSlot === 0}
                  dimmed={
                    firstEndHammerSlot === 0 && hammerEditable && hammerHoverSlot === 1
                  }
                  onSelectHammer={() => onFirstEndHammerChange(0)}
                  onClearHammer={() => onFirstEndHammerChange(null)}
                  onHoverChange={(hovered) => setHammerHoverSlot(hovered ? 0 : null)}
                />
              </th>
              {Array.from({ length: columnCount }, (_, i) => {
                const canEdit = !disabled && !gameComplete && i <= filled;
                return (
                  <td key={i} className="px-1 py-1 text-center">
                    {xColumnIndex === i ? (
                      <span className="inline-flex h-9 w-full items-center justify-center font-semibold text-gray-400">
                        X
                      </span>
                    ) : (
                      <EndScoreCell
                        entry={entries[i] ?? null}
                        side={0}
                        disabled={!canEdit}
                        selected={openEndIndex === i}
                        hasPowerPlay={isDoubles && powerPlayEndSide0 === i + 1}
                        hasNextEndHammer={nextEndHammerSlot === 0 && i === nextUnplayedEndIndex}
                        onOpen={(el) => {
                          openAnchorRef.current = el;
                          setOpenEndIndex(i);
                        }}
                      />
                    )}
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {total0}
              </td>
            </tr>
            <tr className="border-t border-gray-100 dark:border-gray-800">
              <th className="group/lsfe sticky left-0 z-[1] bg-white px-2 py-1.5 text-left font-medium text-gray-800 dark:bg-gray-900 dark:text-gray-100">
                <TeamNameWithHammer
                  label={team1Label}
                  leading={team1Leading}
                  hasHammer={firstEndHammerSlot === 1}
                  canSetHammer={hammerEditable && firstEndHammerSlot !== 1}
                  canClearHammer={hammerEditable && firstEndHammerSlot === 1}
                  dimmed={
                    firstEndHammerSlot === 1 && hammerEditable && hammerHoverSlot === 0
                  }
                  onSelectHammer={() => onFirstEndHammerChange(1)}
                  onClearHammer={() => onFirstEndHammerChange(null)}
                  onHoverChange={(hovered) => setHammerHoverSlot(hovered ? 1 : null)}
                />
              </th>
              {Array.from({ length: columnCount }, (_, i) => {
                const canEdit = !disabled && !gameComplete && i <= filled;
                return (
                  <td key={i} className="px-1 py-1 text-center">
                    {xColumnIndex === i ? (
                      <span className="inline-flex h-9 w-full items-center justify-center font-semibold text-gray-400">
                        X
                      </span>
                    ) : (
                      <EndScoreCell
                        entry={entries[i] ?? null}
                        side={1}
                        disabled={!canEdit}
                        selected={openEndIndex === i}
                        hasPowerPlay={isDoubles && powerPlayEndSide1 === i + 1}
                        hasNextEndHammer={nextEndHammerSlot === 1 && i === nextUnplayedEndIndex}
                        onOpen={(el) => {
                          openAnchorRef.current = el;
                          setOpenEndIndex(i);
                        }}
                      />
                    )}
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {total1}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {openEndIndex != null && !disabled && !gameComplete ? (
        <EndResultPicker
          anchorRef={openAnchorRef}
          openEndIndex={openEndIndex}
          team0Label={team0Label}
          team1Label={team1Label}
          hasValue={entries[openEndIndex] != null}
          onClose={() => setOpenEndIndex(null)}
          onSelect={(value) => {
            setEnd(openEndIndex, value);
            setOpenEndIndex(null);
          }}
        />
      ) : null}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            id={gameCompleteSwitchId}
            role="switch"
            aria-checked={gameComplete}
            disabled={gameCompleteDisabled}
            onClick={() => {
              if (gameCompleteDisabled) return;
              onGameCompleteChange(!gameComplete);
            }}
            className={[
              'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 dark:focus:ring-offset-gray-900',
              gameComplete ? 'bg-primary-teal' : 'bg-gray-200 dark:bg-gray-600',
              gameCompleteDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            ].join(' ')}
          >
            <span
              className={[
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition',
                gameComplete ? 'translate-x-5' : 'translate-x-1',
              ].join(' ')}
              aria-hidden
            />
          </button>
          <label
            htmlFor={gameCompleteSwitchId}
            className={`text-sm font-medium text-gray-700 dark:text-gray-300 ${
              gameCompleteDisabled ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
            }`}
          >
            Game complete
          </label>
        </div>
        <FormFieldMessage intent="helper">
          {filled === 0
            ? 'Enter at least one end before marking the game complete.'
            : gameComplete
              ? `Completed after end ${filled}. Turn off to edit scores.`
              : `Scores save as you enter them. Turning this on marks end ${filled} as the final end.`}
        </FormFieldMessage>
      </div>
    </div>
  );
}

function TeamNameWithHammer({
  label,
  leading,
  hasHammer,
  canSetHammer,
  canClearHammer,
  dimmed,
  onSelectHammer,
  onClearHammer,
  onHoverChange,
}: {
  label: string;
  leading?: ReactNode;
  hasHammer: boolean;
  /** True when clicking would assign LSFE to this team. */
  canSetHammer: boolean;
  /** True when this team has LSFE and clicking would clear it. */
  canClearHammer: boolean;
  /** True when the other team's set-target is hovered — gray out this team's set icon. */
  dimmed: boolean;
  onSelectHammer: () => void;
  onClearHammer: () => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const interactive = canSetHammer || canClearHammer;
  /** After clearing LSFE, hide the set-preview icon until the pointer leaves (even if still hovering). */
  const [suppressSetPreview, setSuppressSetPreview] = useState(false);

  return (
    <>
      <span className="inline-flex max-w-[12rem] items-center gap-2">
        {leading ? <span className="relative z-[2] shrink-0">{leading}</span> : null}
        <span className="line-clamp-2" title={label}>
          {label}
        </span>
        {canSetHammer ? (
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden>
            <IoHammer
              className={`h-3.5 w-3.5 text-primary-teal ${
                suppressSetPreview
                  ? 'opacity-0'
                  : 'opacity-0 group-hover/lsfe:opacity-100 group-focus-within/lsfe:opacity-100'
              }`}
              aria-hidden
            />
          </span>
        ) : hasHammer ? (
          <span
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center"
            title={interactive ? undefined : 'Last stone in first end'}
            aria-hidden={interactive ? true : undefined}
            aria-label={interactive ? undefined : `${label} has last stone in first end`}
          >
            <IoHammer
              className={`h-3.5 w-3.5 ${
                dimmed ? 'text-gray-400 dark:text-gray-500' : 'text-primary-teal'
              }`}
              aria-hidden
            />
          </span>
        ) : (
          <span className="inline-flex h-7 w-7 shrink-0" aria-hidden />
        )}
      </span>
      {canSetHammer ? (
        <button
          type="button"
          title={`Set last stone in first end for ${label}`}
          aria-label={`Set last stone in first end for ${label}`}
          onMouseEnter={() => onHoverChange(true)}
          onMouseLeave={() => {
            setSuppressSetPreview(false);
            onHoverChange(false);
          }}
          onFocus={() => {
            if (!suppressSetPreview) onHoverChange(true);
          }}
          onBlur={() => onHoverChange(false)}
          onClick={(e) => {
            e.stopPropagation();
            onSelectHammer();
          }}
          className="absolute inset-0 z-[1] cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-teal/40"
        />
      ) : canClearHammer ? (
        <button
          type="button"
          title="Clear last stone in first end"
          aria-label={`Clear last stone in first end for ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setSuppressSetPreview(true);
            onClearHammer();
            e.currentTarget.blur();
          }}
          className="absolute inset-0 z-[1] cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-teal/40"
        />
      ) : null}
    </>
  );
}

function EndScoreCell({
  entry,
  side,
  disabled,
  selected,
  hasPowerPlay,
  hasNextEndHammer,
  onOpen,
}: {
  entry: EndScoreEntry | null;
  side: 0 | 1;
  disabled: boolean;
  selected: boolean;
  hasPowerPlay: boolean;
  hasNextEndHammer: boolean;
  onOpen: (el: HTMLButtonElement) => void;
}) {
  const display =
    entry == null ? '' : side === 0 ? String(entry.side0) : String(entry.side1);
  const isBlank = entry != null && entry.side0 === 0 && entry.side1 === 0;
  const showHammerPlaceholder = display === '' && hasNextEndHammer;

  return (
    <div className="flex flex-col items-center gap-0.5">
      {hasPowerPlay ? (
        <span className="text-[0.65rem] font-medium leading-none text-primary-teal" title="Power play">
          PP
        </span>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={selected}
        title={showHammerPlaceholder ? 'Has hammer this end' : undefined}
        aria-label={showHammerPlaceholder ? 'Has hammer this end' : undefined}
        onClick={(e) => {
          if (disabled) return;
          onOpen(e.currentTarget);
        }}
        className={`inline-flex h-9 w-full min-w-[2.5rem] items-center justify-center rounded-md border text-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 disabled:cursor-default disabled:opacity-50 ${
          selected
            ? 'border-primary-teal bg-primary-teal/10'
            : 'border-gray-300 bg-white hover:border-primary-teal/50 dark:border-gray-600 dark:bg-gray-800'
        } ${isBlank ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}
      >
        {showHammerPlaceholder ? (
          <IoHammer className="h-3.5 w-3.5 text-primary-teal" aria-hidden />
        ) : display === '' ? (
          '·'
        ) : (
          display
        )}
      </button>
    </div>
  );
}

function EndResultPicker({
  anchorRef,
  openEndIndex,
  team0Label,
  team1Label,
  hasValue,
  onClose,
  onSelect,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  openEndIndex: number;
  team0Label: string;
  team1Label: string;
  hasValue: boolean;
  onClose: () => void;
  onSelect: (value: EndScoreEntry | null) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) {
      setPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const menuWidth = 224;
    setPos({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
    });
  }, [anchorRef, openEndIndex]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label="End result"
      className="fixed z-[120] w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-600 dark:bg-gray-800"
      style={{ top: pos.top, left: pos.left }}
    >
      <button
        type="button"
        role="option"
        className="mb-1 w-full rounded-md border border-dashed border-gray-300 px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-500 dark:text-gray-200 dark:hover:bg-gray-700"
        onClick={() => onSelect({ side0: 0, side1: 0 })}
      >
        Blank end
      </button>
      <div className="grid grid-cols-2 gap-1">
        <div
          className="truncate px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400"
          title={team0Label}
        >
          {team0Label}
        </div>
        <div
          className="truncate px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400"
          title={team1Label}
        >
          {team1Label}
        </div>
        {Array.from({ length: MAX_POINTS }, (_, i) => {
          const points = i + 1;
          return (
            <div key={points} className="contents">
              <button
                type="button"
                role="option"
                aria-label={`${points} for ${team0Label}`}
                title={`${points} for ${team0Label}`}
                className="rounded-md px-2 py-1.5 text-center text-sm font-medium tabular-nums hover:bg-primary-teal/10 dark:hover:bg-primary-teal/20"
                onClick={() => onSelect({ side0: points, side1: 0 })}
              >
                {points}
              </button>
              <button
                type="button"
                role="option"
                aria-label={`${points} for ${team1Label}`}
                title={`${points} for ${team1Label}`}
                className="rounded-md px-2 py-1.5 text-center text-sm font-medium tabular-nums hover:bg-primary-teal/10 dark:hover:bg-primary-teal/20"
                onClick={() => onSelect({ side0: 0, side1: points })}
              >
                {points}
              </button>
            </div>
          );
        })}
      </div>
      {hasValue ? (
        <button
          type="button"
          className="mt-1 w-full rounded-md px-2 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
          onClick={() => onSelect(null)}
        >
          Clear end
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
