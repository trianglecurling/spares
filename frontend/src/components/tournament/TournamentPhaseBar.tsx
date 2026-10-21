import { useEffect, useId, useRef, useState } from 'react';
import { HiChevronDown, HiEllipsisHorizontal } from 'react-icons/hi2';
import Button from '../Button';
import FormField from '../FormField';
import Modal from '../Modal';
import PageTabs from '../PageTabs';
import type { TournamentPhase, TournamentPhaseKind } from '../../utils/tournamentDrawModel';

type TournamentPhaseBarProps = {
  phases: TournamentPhase[];
  activePhaseId: string | null;
  canAdd: boolean;
  onSelect: (phaseId: string) => void;
  onAdd: (kind: TournamentPhaseKind) => void;
  onRename: (phaseId: string, name: string) => void;
  onMove: (phaseId: string, delta: -1 | 1) => void;
  onDelete: (phaseId: string) => void;
};

const menuItemClass =
  'w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700';
const menuClass =
  'absolute right-0 z-50 mt-1 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800';

export default function TournamentPhaseBar({
  phases,
  activePhaseId,
  canAdd,
  onSelect,
  onAdd,
  onRename,
  onMove,
  onDelete,
}: TournamentPhaseBarProps) {
  const renameFieldId = useId();
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const addRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!addOpen && !moreOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (addRef.current?.contains(t) || moreRef.current?.contains(t)) return;
      setAddOpen(false);
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAddOpen(false);
      setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [addOpen, moreOpen]);

  const activeIndex = phases.findIndex((p) => p.id === activePhaseId);
  const active = activeIndex >= 0 ? phases[activeIndex] : undefined;

  const submitRename = () => {
    if (!active) return;
    const name = renameValue.trim();
    if (name) onRename(active.id, name.slice(0, 120));
    setRenameOpen(false);
  };

  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-gray-200 dark:border-gray-600">
      <PageTabs
        ariaLabel="Tournament phases"
        className="min-w-0 flex-1 !mb-0 !border-b-0"
        items={phases.map((p, i) => ({
          key: p.id,
          label: phases.length > 1 ? `${i + 1}. ${p.name}` : p.name,
          isActive: p.id === activePhaseId,
          onClick: () => onSelect(p.id),
        }))}
      />
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <div className="relative" ref={addRef}>
          <Button
            type="button"
            variant="secondary"
            className="h-9 gap-1 px-3 text-sm"
            aria-haspopup="menu"
            aria-expanded={addOpen}
            disabled={!canAdd}
            onClick={() => {
              setAddOpen((o) => !o);
              setMoreOpen(false);
            }}
          >
            Add phase
            <HiChevronDown className="h-4 w-4" aria-hidden />
          </Button>
          {addOpen ? (
            <div className={menuClass} role="menu">
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setAddOpen(false);
                  onAdd('pool');
                }}
              >
                Pool play
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setAddOpen(false);
                  onAdd('bracket');
                }}
              >
                Bracket
              </button>
            </div>
          ) : null}
        </div>
        {active ? (
          <div className="relative" ref={moreRef}>
            <Button
              type="button"
              variant="secondary"
              className="h-9 w-9 shrink-0 !p-0"
              aria-label={`Phase options for ${active.name}`}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => {
                setMoreOpen((o) => !o);
                setAddOpen(false);
              }}
            >
              <HiEllipsisHorizontal className="h-5 w-5" aria-hidden />
            </Button>
            {moreOpen ? (
              <div className={menuClass} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    setMoreOpen(false);
                    setRenameValue(active.name);
                    setRenameOpen(true);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={activeIndex <= 0}
                  onClick={() => {
                    setMoreOpen(false);
                    onMove(active.id, -1);
                  }}
                >
                  Move earlier
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={activeIndex >= phases.length - 1}
                  onClick={() => {
                    setMoreOpen(false);
                    onMove(active.id, 1);
                  }}
                >
                  Move later
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`${menuItemClass} text-red-700 dark:text-red-400`}
                  disabled={phases.length <= 1}
                  onClick={() => {
                    setMoreOpen(false);
                    onDelete(active.id);
                  }}
                >
                  Delete phase
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <Modal isOpen={renameOpen} onClose={() => setRenameOpen(false)} title="Rename phase" size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitRename();
          }}
        >
          <FormField label="Name" htmlFor={renameFieldId}>
            <input
              id={renameFieldId}
              className="app-input w-full"
              value={renameValue}
              maxLength={120}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!renameValue.trim()}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
