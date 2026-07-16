import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  resolveSheetStoneColorHex,
  sheetStoneColorLabel,
} from '../../utils/sheetStoneColors';
import type { SheetStoneColors } from '../../utils/tournamentRockColors';

function StoneColorSwatch({ color, className = '' }: { color: string; className?: string }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/15 dark:border-white/20 ${className}`}
      style={{ backgroundColor: resolveSheetStoneColorHex(color) }}
      aria-hidden
    />
  );
}

/** Read-only rock color indicator (e.g. randomized mode). */
export function RockColorSwatch({
  color,
  className = '',
  title,
}: {
  color: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/15 dark:border-white/20 ${className}`}
      style={{ backgroundColor: resolveSheetStoneColorHex(color) }}
      title={title ?? sheetStoneColorLabel(color)}
      aria-hidden
    />
  );
}

type ScorekeeperRockColorControlProps = {
  teamLabel: string;
  colors: SheetStoneColors;
  /** Which sheet color this team currently has (1 / 2), or null if unset. */
  assignedWhich: 1 | 2 | null;
  disabled?: boolean;
  className?: string;
  onChoose: (whichColor: 1 | 2) => void;
  onUnset: () => void;
};

/**
 * Clickable rock-color dot before the team name.
 * Filled when assigned; hollow outline when unset.
 */
export default function ScorekeeperRockColorControl({
  teamLabel,
  colors,
  assignedWhich,
  disabled = false,
  className = '',
  onChoose,
  onUnset,
}: ScorekeeperRockColorControlProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const assignedColor =
    assignedWhich === 1
      ? colors.stoneColor1
      : assignedWhich === 2
        ? colors.stoneColor2
        : null;
  const title =
    assignedColor != null
      ? `Rock color: ${sheetStoneColorLabel(assignedColor)}`
      : 'Set rock color';

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Rock color for ${teamLabel}`}
        title={title}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          setOpen((v) => !v);
        }}
        className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 focus-visible:ring-offset-1 disabled:cursor-default disabled:opacity-50 ${className}`}
      >
        {assignedColor != null ? (
          <span
            className="h-3.5 w-3.5 rounded-full border border-black/15 dark:border-white/20"
            style={{ backgroundColor: resolveSheetStoneColorHex(assignedColor) }}
            aria-hidden
          />
        ) : (
          <span
            className="h-3.5 w-3.5 rounded-full border-2 border-dashed border-gray-400 bg-transparent dark:border-gray-500"
            aria-hidden
          />
        )}
      </button>
      {open ? (
        <RockColorPopover
          anchorRef={anchorRef}
          colors={colors}
          assignedWhich={assignedWhich}
          teamLabel={teamLabel}
          onClose={() => setOpen(false)}
          onChoose={(which) => {
            onChoose(which);
            setOpen(false);
          }}
          onUnset={() => {
            onUnset();
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function rockColorMenuButtons(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
}

function RockColorPopover({
  anchorRef,
  colors,
  assignedWhich,
  teamLabel,
  onClose,
  onChoose,
  onUnset,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  colors: SheetStoneColors;
  assignedWhich: 1 | 2 | null;
  teamLabel: string;
  onClose: () => void;
  onChoose: (which: 1 | 2) => void;
  onUnset: () => void;
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
    const menuWidth = 200;
    setPos({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
    });
  }, [anchorRef]);

  useEffect(() => {
    if (pos == null) return;
    const menu = menuRef.current;
    if (!menu) return;
    const buttons = rockColorMenuButtons(menu);
    const initialIdx = assignedWhich === 1 ? 0 : assignedWhich === 2 ? 1 : 0;
    buttons[initialIdx]?.focus();
    return () => {
      // Return focus to the trigger when the menu unmounts (Escape, choose, outside click).
      anchorRef.current?.focus();
    };
  }, [pos, assignedWhich, anchorRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      const menu = menuRef.current;
      if (!menu) return;
      // Only hijack arrows when focus is in the menu or still on the trigger.
      const focusInMenu = menu.contains(document.activeElement);
      const focusOnTrigger = anchorRef.current?.contains(document.activeElement) ?? false;
      if (!focusInMenu && !focusOnTrigger) return;

      const buttons = rockColorMenuButtons(menu);
      if (buttons.length === 0) return;

      const activeIdx = buttons.findIndex((b) => b === document.activeElement);
      const focusAt = (idx: number) => {
        const next = buttons[(idx + buttons.length) % buttons.length];
        next?.focus();
      };

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusAt(activeIdx < 0 ? 0 : activeIdx + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusAt(activeIdx < 0 ? buttons.length - 1 : activeIdx - 1);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        focusAt(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        focusAt(buttons.length - 1);
      }
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    // Capture so ArrowDown is handled even when the trigger sits under a parent that stops key bubbling.
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [anchorRef, onClose]);

  if (pos == null) return null;

  const options: Array<{ which: 1 | 2; color: string }> = [
    { which: 1, color: colors.stoneColor1 },
    { which: 2, color: colors.stoneColor2 },
  ];

  return createPortal(
    <div
      ref={menuRef}
      role="dialog"
      aria-label={`Choose rock color for ${teamLabel}`}
      className="fixed z-[80] w-[12.5rem] rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-600 dark:bg-gray-900"
      style={{ top: pos.top, left: pos.left }}
    >
      <ul className="space-y-0.5" role="listbox" aria-label="Rock colors">
        {options.map((opt) => {
          const selected = assignedWhich === opt.which;
          return (
            <li key={opt.which} role="option" aria-selected={selected}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 ${
                  selected
                    ? 'bg-primary-teal/10 text-gray-900 dark:text-gray-100'
                    : 'text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => onChoose(opt.which)}
              >
                <StoneColorSwatch color={opt.color} />
                <span>{sheetStoneColorLabel(opt.color)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-700">
        <button
          type="button"
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-300 dark:hover:bg-gray-800"
          onClick={onUnset}
        >
          Unset colors
        </button>
      </div>
    </div>,
    document.body,
  );
}
