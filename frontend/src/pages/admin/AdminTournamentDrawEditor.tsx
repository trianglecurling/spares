import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useBeforeUnload, useLocation, useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption, type ChoiceRenderableOption } from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';
import PageTabs from '../../components/PageTabs';
import SortableList from '../../components/dragDrop/SortableList';
import SortableRow from '../../components/dragDrop/SortableRow';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import {
  HiArrowUturnLeft,
  HiArrowsPointingOut,
  HiChevronDown,
  HiEllipsisHorizontal,
  HiTrash,
} from 'react-icons/hi2';
import api, { formatApiError } from '../../utils/api';
import { emptyTournamentDraw } from '../../utils/tournamentDrawBuilders';
import {
  decodeSlotSource,
  encodeSlotSource,
  ordinalPlaceLabel,
  outputRoutingLabel,
  type TournamentBracketEvent,
  type TournamentConnectionEdge,
  type TournamentDrawState,
  type TournamentGameNode,
  type TournamentGameResult,
  type TournamentSlotSource,
  type TournamentTextNode,
} from '../../utils/tournamentDrawModel';
import {
  incomingGameFeedersSorted,
  formatFeederPipeLabel,
  normalizeDrawState,
} from '../../utils/tournamentDrawRouting';
import { formatTeamDisplayName } from '../../utils/tournamentDisplay';
import {
  buildTournamentDrawTemplate,
  downloadTournamentDrawTemplate,
  hasExistingDrawStructure,
  parseTournamentDrawTemplate,
  tournamentDrawStateFromTemplate,
} from '../../utils/tournamentDrawTemplate';
import {
  formatDrawBlockOptionLabel,
  nextAdHocTournamentSheetId,
  sheetsFromClubSheets,
  type ClubSheet,
} from '../../utils/tournamentDrawSchedule';
import type { TournamentTeamApi } from './AdminEventTournamentTeamModal';
import AdminTournamentDrawResultsTab from './AdminTournamentDrawResultsTab';
import TournamentDrawBracketScene from '../../components/TournamentDrawBracketScene';
import { useBracketCanvasView } from '../../hooks/useBracketCanvasView';
import {
  layoutDraw,
  computeBracketEdgePaths,
  computeTextConnectorPaths,
  resolveTextNodeLayout,
  CARD_W,
  CARD_H,
  LANE_HEADER,
  COL_W,
  GAP_Y,
  LANE_BOTTOM,
  LANE_INNER_PAD_BOTTOM,
} from '../../utils/tournamentDrawBracketLayout';

type DrawWorkspaceTab = 'setup' | 'structure' | 'results';

function drawWorkspaceTabFromHash(hash: string): DrawWorkspaceTab | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === 'setup' || raw === 'structure' || raw === 'results') return raw;
  return null;
}

/** True when focus is in a control where a letter key would edit text (do not bind F to fullscreen). */
function documentActiveElementIsTextEditing(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.closest('[contenteditable="true"]')) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type.toLowerCase();
    if (
      t === 'checkbox' ||
      t === 'radio' ||
      t === 'button' ||
      t === 'submit' ||
      t === 'reset' ||
      t === 'file' ||
      t === 'hidden' ||
      t === 'range' ||
      t === 'color' ||
      t === 'image'
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * ChoiceInput uses an open listbox + typeahead; letter keys (including F) must reach the combobox/listbox.
 * Covers focus on the expanded trigger (`role="combobox"` + `aria-expanded="true"`) or inside the list panel.
 */
function documentActiveElementIsInsideOpenChoiceDropdown(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[role="listbox"]')) return true;
  const combobox = el.closest('[role="combobox"]');
  return combobox instanceof HTMLElement && combobox.getAttribute('aria-expanded') === 'true';
}

type AdminTournamentDrawEditorProps = {
  eventId: number;
  teams: TournamentTeamApi[];
  /** Used as the default prefix for exported template JSON filenames. */
  exportTemplateFilenameBase?: string;
};

function connectionSummary(
  c: TournamentConnectionEdge | undefined,
  games: Record<string, TournamentGameNode>,
): string {
  if (!c) return 'Not set';
  if (c.terminalType === 'out') return 'Out of tournament';
  if (c.terminalType === 'tbd') return 'TBD';
  const g = c.toGameId ? games[c.toGameId] : undefined;
  if (!g) return 'Game…';
  return g.label;
}

function stripConnectionsForPlace(
  connections: TournamentConnectionEdge[],
  fromGameId: string,
  place: number,
): TournamentConnectionEdge[] {
  return connections.filter((c) => !(c.fromGameId === fromGameId && c.place === place));
}

function setPlaceConnection(
  draw: TournamentDrawState,
  fromGameId: string,
  place: number,
  next: Omit<TournamentConnectionEdge, 'id' | 'fromGameId' | 'place'> & { id?: string },
): TournamentDrawState {
  const id = next.id ?? crypto.randomUUID();
  const rest = stripConnectionsForPlace(draw.connections, fromGameId, place);
  return normalizeDrawState({
    ...draw,
    connections: [...rest, { id, fromGameId, place, ...next }],
  });
}

function nextLabelInLane(games: Record<string, TournamentGameNode>, eventId: string, code: string): string {
  const nums = Object.values(games)
    .filter((g) => g.eventId === eventId && g.label.startsWith(code))
    .map((g) => {
      const n = Number.parseInt(g.label.slice(code.length), 10);
      return Number.isFinite(n) ? n : 0;
    });
  const max = nums.length ? Math.max(...nums) : 0;
  return `${code}${max + 1}`;
}

function sortedBracketEvents(events: TournamentBracketEvent[]): TournamentBracketEvent[] {
  return [...events].sort((a, b) => a.order - b.order);
}

type TournamentDrawBlocksSectionProps = {
  draw: TournamentDrawState;
  updateDraw: (fn: (d: TournamentDrawState) => TournamentDrawState, opts?: { markDirty?: boolean }) => void;
};

function TournamentDrawBlocksSection({ draw, updateDraw }: TournamentDrawBlocksSectionProps) {
  const sorted = useMemo(
    () => [...draw.drawBlocks].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [draw.drawBlocks],
  );
  return (
    <FormSection
      title="Draw times"
      description="Named draws with a start date and time. Games reference these from the Structure inspector."
      surface="panel"
    >
      <div className="space-y-3">
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No draws yet — add one to assign games to a date and time.
          </p>
        ) : null}
        {sorted.map((b) => (
          <div
            key={b.id}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 dark:border-gray-600 p-3"
          >
            <FormField label="Name" htmlFor={`db-name-${b.id}`} className="min-w-[8rem] flex-1">
              <input
                id={`db-name-${b.id}`}
                className="app-input w-full"
                value={b.name}
                onChange={(e) =>
                  updateDraw((d) => ({
                    ...d,
                    drawBlocks: d.drawBlocks.map((x) => (x.id === b.id ? { ...x, name: e.target.value } : x)),
                  }))
                }
              />
            </FormField>
            <FormField label="Start" htmlFor={`db-st-${b.id}`} className="min-w-[12rem] flex-1">
              <input
                id={`db-st-${b.id}`}
                type="datetime-local"
                className="app-input w-full"
                value={b.startTime ?? ''}
                onChange={(e) =>
                  updateDraw((d) => ({
                    ...d,
                    drawBlocks: d.drawBlocks.map((x) =>
                      x.id === b.id ? { ...x, startTime: e.target.value || null } : x,
                    ),
                  }))
                }
              />
            </FormField>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              onClick={() =>
                updateDraw((d) => {
                  const nextBlocks = d.drawBlocks.filter((x) => x.id !== b.id);
                  const games = { ...d.games };
                  for (const [gid, g] of Object.entries(games)) {
                    if (g.schedule?.drawBlockId === b.id) {
                      games[gid] = {
                        ...g,
                        schedule: { ...g.schedule, drawBlockId: null },
                      };
                    }
                  }
                  return { ...d, drawBlocks: nextBlocks, games };
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            updateDraw((d) => {
              const maxOrder = d.drawBlocks.length ? Math.max(...d.drawBlocks.map((x) => x.order)) : -1;
              const n = d.drawBlocks.length + 1;
              const id = crypto.randomUUID();
              return {
                ...d,
                drawBlocks: [
                  ...d.drawBlocks,
                  { id, name: `Draw ${n}`, order: maxOrder + 1, startTime: null },
                ],
              };
            })
          }
        >
          Add draw
        </Button>
      </div>
    </FormSection>
  );
}

type TournamentSheetsSectionProps = {
  draw: TournamentDrawState;
  updateDraw: (fn: (d: TournamentDrawState) => TournamentDrawState, opts?: { markDirty?: boolean }) => void;
  clubSheets: ClubSheet[];
};

function TournamentSheetsSection({ draw, updateDraw, clubSheets }: TournamentSheetsSectionProps) {
  const addSheetInputId = useId();
  const [addSheetQuery, setAddSheetQuery] = useState('');
  const inDraw = useMemo(() => new Set(draw.sheets.map((s) => s.clubSheetId)), [draw.sheets]);

  const sortedSheets = useMemo(
    () => [...draw.sheets].sort((a, b) => a.order - b.order || a.clubSheetId - b.clubSheetId),
    [draw.sheets],
  );

  const addSheetFromQuery = () => {
    const raw = addSheetQuery.trim();
    if (!raw) return;
    const clubActive = clubSheets.filter((s) => s.isActive !== false);
    let sheetId: number | null = null;
    let resolvedName: string | null = null;

    if (/^\d+$/.test(raw)) {
      const id = Number.parseInt(raw, 10);
      const c = clubActive.find((x) => x.id === id);
      if (c) {
        sheetId = id;
        resolvedName = c.name;
      }
    }
    if (sheetId == null) {
      const q = raw.toLowerCase();
      const available = clubActive.filter((c) => !inDraw.has(c.id));
      const exact = available.find((c) => c.name.trim().toLowerCase() === q);
      const partial =
        exact ??
        available.find((c) => c.name.toLowerCase().includes(q));
      if (partial) {
        sheetId = partial.id;
        resolvedName = partial.name;
      }
    }

    if (sheetId != null && inDraw.has(sheetId)) {
      window.alert('That sheet is already in this tournament.');
      return;
    }

    updateDraw((d) => {
      let id = sheetId;
      let name = resolvedName;
      if (id == null) {
        id = nextAdHocTournamentSheetId(d.sheets);
        name = raw;
      } else {
        if (d.sheets.some((x) => x.clubSheetId === id)) return d;
      }
      const maxOrder = d.sheets.length ? Math.max(...d.sheets.map((x) => x.order)) : -1;
      return {
        ...d,
        sheets: [
          ...d.sheets,
          {
            clubSheetId: id,
            name: name ?? `Sheet ${id}`,
            order: maxOrder + 1,
          },
        ],
      };
    });
    setAddSheetQuery('');
  };

  return (
    <FormSection
      title="Sheets"
      description="Club sheets (from Manage sheets) or custom names for this tournament only."
      surface="panel"
    >
      <div className="space-y-3">
        {sortedSheets.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No sheets yet — add by club name or ID, type a custom sheet name, or reset to club defaults.
          </p>
        ) : (
          <ul className="space-y-2">
            {sortedSheets.map((s) => (
              <li
                key={s.clubSheetId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
              >
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{s.name}</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    updateDraw((d) => {
                      const nextSheets = d.sheets.filter((x) => x.clubSheetId !== s.clubSheetId);
                      const games = { ...d.games };
                      for (const [gid, g] of Object.entries(games)) {
                        if (g.schedule?.sheetId === s.clubSheetId) {
                          games[gid] = {
                            ...g,
                            schedule: { ...g.schedule, sheetId: null, sheetLabel: null },
                          };
                        }
                      }
                      return { ...d, sheets: nextSheets, games };
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-2 sm:min-w-[16rem]">
            <input
              id={addSheetInputId}
              type="text"
              className="app-input min-w-[8rem] flex-1"
              placeholder="Club sheet, ID, or custom name"
              aria-label="Club sheet name, club sheet ID, or custom sheet name"
              value={addSheetQuery}
              onChange={(e) => setAddSheetQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSheetFromQuery();
                }
              }}
            />
            <Button type="button" variant="primary" onClick={addSheetFromQuery}>
              Add
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              updateDraw((d) => {
                const fresh = sheetsFromClubSheets(clubSheets);
                const games = { ...d.games };
                const allowed = new Set(fresh.map((x) => x.clubSheetId));
                for (const [gid, g] of Object.entries(games)) {
                  const sid = g.schedule?.sheetId;
                  if (sid != null && !allowed.has(sid)) {
                    games[gid] = {
                      ...g,
                      schedule: { ...g.schedule, sheetId: null, sheetLabel: null },
                    };
                  }
                }
                return { ...d, sheets: fresh, games };
              })
            }
          >
            Reset to club sheets
          </Button>
        </div>
      </div>
    </FormSection>
  );
}

export default function AdminTournamentDrawEditor({
  eventId,
  teams,
  exportTemplateFilenameBase = '',
}: AdminTournamentDrawEditorProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();
  const [draw, setDraw] = useState<TournamentDrawState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<DrawWorkspaceTab>(
    () => drawWorkspaceTabFromHash(location.hash) ?? 'setup',
  );
  const [structureFullWindow, setStructureFullWindow] = useState(false);
  const [structureToolbarAddMenuOpen, setStructureToolbarAddMenuOpen] = useState(false);
  const [structureToolbarMoreMenuOpen, setStructureToolbarMoreMenuOpen] = useState(false);
  const [fullWindowMoreMenuOpen, setFullWindowMoreMenuOpen] = useState(false);
  const structureToolbarAddMenuRef = useRef<HTMLDivElement | null>(null);
  const structureToolbarMoreMenuRef = useRef<HTMLDivElement | null>(null);
  const fullWindowMoreMenuRef = useRef<HTMLDivElement | null>(null);
  const [bracketEventsModalOpen, setBracketEventsModalOpen] = useState(false);
  const bracketEventsModalSessionRef = useRef<{
    events: TournamentBracketEvent[];
    eventCount: number;
    hadDirtyOnOpen: boolean;
  } | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedTextNodeId, setSelectedTextNodeId] = useState<string | null>(null);
  /** Event lane to use for the next Add game (from last selected game, or null → first event). */
  const lastInteractedGameEventIdRef = useRef<string | null>(null);
  const [clubSheets, setClubSheets] = useState<ClubSheet[]>([]);
  const drawRef = useRef<TournamentDrawState | null>(null);
  /** Debounced PATCH per game id (results tab). */
  const resultPatchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const bracketEventsListId = useId();
  const importTemplateInputId = useId();
  const importInputRef = useRef<HTMLInputElement>(null);

  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const navigateDrawHash = useCallback(
    (nextHash: string, replace: boolean) => {
      navigate(
        {
          pathname: location.pathname,
          search: location.search,
          hash: nextHash,
        },
        { replace },
      );
    },
    [navigate, location.pathname, location.search],
  );

  const selectWorkspaceTabFromUserClick = useCallback(
    (tab: DrawWorkspaceTab) => {
      setWorkspaceTab(tab);
      navigateDrawHash(`#${tab}`, false);
    },
    [navigateDrawHash],
  );

  const selectWorkspaceTabReplaceHash = useCallback(
    (tab: DrawWorkspaceTab) => {
      setWorkspaceTab(tab);
      navigateDrawHash(`#${tab}`, true);
    },
    [navigateDrawHash],
  );

  useEffect(() => {
    const tab = drawWorkspaceTabFromHash(location.hash);
    if (tab != null) {
      setWorkspaceTab(tab);
    }
  }, [location.hash]);

  useEffect(() => {
    if (!structureToolbarAddMenuOpen && !structureToolbarMoreMenuOpen && !fullWindowMoreMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (structureToolbarAddMenuRef.current?.contains(t)) return;
      if (structureToolbarMoreMenuRef.current?.contains(t)) return;
      if (fullWindowMoreMenuRef.current?.contains(t)) return;
      setStructureToolbarAddMenuOpen(false);
      setStructureToolbarMoreMenuOpen(false);
      setFullWindowMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [structureToolbarAddMenuOpen, structureToolbarMoreMenuOpen, fullWindowMoreMenuOpen]);

  const confirmDiscardChanges = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: 'Discard unsaved changes?',
      message: 'You have unsaved changes. Leave this page and discard them?',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      variant: 'warning',
    });
  }, [confirm, dirty]);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [dirty],
    ),
  );

  useEffect(() => {
    if (!dirty) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const target = event.target as Element | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      const rawHref = anchor.getAttribute('href');
      if (
        !rawHref ||
        rawHref.startsWith('#') ||
        rawHref.startsWith('mailto:') ||
        rawHref.startsWith('tel:')
      )
        return;
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin !== current.origin) return;
      if (
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash === current.hash
      ) {
        return;
      }
      event.preventDefault();
      void (async () => {
        const shouldLeave = await confirmDiscardChanges();
        if (!shouldLeave) return;
        navigate(`${destination.pathname}${destination.search}${destination.hash}`);
      })();
    };
    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [confirmDiscardChanges, dirty, navigate]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<{ draw: TournamentDrawState | null }>(`/events/${eventId}/tournament-draw`),
      api.get<ClubSheet[]>(`/sheets`).catch(() => ({ data: [] as ClubSheet[] })),
    ])
      .then(([drawRes, sheetsRes]) => {
        const raw = drawRes.data?.draw ?? null;
        const club = sheetsRes.data ?? [];
        setClubSheets(club);
        if (!raw) {
          setDraw(null);
          setDirty(false);
          return;
        }
        let d = normalizeDrawState(raw);
        if (d.sheets.length === 0 && club.length > 0) {
          d = { ...d, sheets: sheetsFromClubSheets(club) };
        }
        setDraw(d);
        setDirty(false);
      })
      .catch((err) => setLoadError(formatApiError(err, 'Failed to load draw')))
      .finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  useEffect(
    () => () => {
      for (const t of Object.values(resultPatchTimersRef.current)) {
        clearTimeout(t);
      }
      resultPatchTimersRef.current = {};
    },
    [],
  );

  useEffect(() => {
    if (!structureFullWindow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStructureFullWindow(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [structureFullWindow]);

  useEffect(() => {
    if (workspaceTab !== 'structure') setStructureFullWindow(false);
  }, [workspaceTab]);

  useEffect(() => {
    if (workspaceTab !== 'structure') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (documentActiveElementIsTextEditing()) return;
      if (documentActiveElementIsInsideOpenChoiceDropdown()) return;
      if (bracketEventsModalOpen) return;
      if (structureToolbarAddMenuOpen || structureToolbarMoreMenuOpen || fullWindowMoreMenuOpen) return;
      e.preventDefault();
      setStructureFullWindow((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    workspaceTab,
    bracketEventsModalOpen,
    structureToolbarAddMenuOpen,
    structureToolbarMoreMenuOpen,
    fullWindowMoreMenuOpen,
  ]);

  useEffect(() => {
    if (!draw || !selectedGameId) return;
    const g = draw.games[selectedGameId];
    if (g) lastInteractedGameEventIdRef.current = g.eventId;
  }, [draw, selectedGameId]);

  const layout = useMemo(() => (draw ? layoutDraw(draw) : null), [
    draw,
    // Layout is derived from module constants too; include them so memo invalidates when geometry changes (e.g. HMR) while `draw` is referentially stable.
    COL_W,
    CARD_W,
    CARD_H,
    GAP_Y,
    LANE_HEADER,
    LANE_BOTTOM,
    LANE_INNER_PAD_BOTTOM,
  ]);

  const edgePaths = useMemo(() => {
    if (!draw || !layout) return [];
    return computeBracketEdgePaths(draw, layout);
  }, [draw, layout]);

  const textConnectorPaths = useMemo(() => {
    if (!draw || !layout) return [];
    return computeTextConnectorPaths(draw, layout);
  }, [draw, layout]);

  const clearCanvasSelection = useCallback(() => {
    setSelectedGameId(null);
    setSelectedTextNodeId(null);
  }, []);

  const bracketView = useBracketCanvasView({
    enabled: workspaceTab === 'structure' && !!layout && !!draw,
    onCanvasBackgroundTap: clearCanvasSelection,
    onBracketShortPress: (hit) => {
      if (hit.type === 'text') {
        setSelectedGameId(null);
        setSelectedTextNodeId(hit.textNodeId);
        return;
      }
      setSelectedTextNodeId(null);
      setSelectedGameId(hit.type === 'game' ? hit.gameId : hit.sourceGameId);
    },
    attachToken: layout?.width,
  });

  const persist = useCallback(async (next: TournamentDrawState) => {
    setSaving(true);
    try {
      const payload = normalizeDrawState(next);
      await api.put(`/events/${eventId}/tournament-draw`, payload);
      setDraw(payload);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [eventId]);

  const openImportTemplatePicker = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const onImportTemplateFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          showAlert('Invalid JSON file.', 'error');
          return;
        }
        const result = parseTournamentDrawTemplate(parsed);
        if (!result.ok) {
          showAlert(result.error, 'error');
          return;
        }
        if (hasExistingDrawStructure(draw)) {
          const ok = await confirm({
            title: 'Replace existing draw?',
            message:
              'Importing will overwrite this event’s tournament draw structure (games, connections, scheduling hooks, and canvas notes). This cannot be undone.',
            confirmText: 'Import and replace',
            variant: 'warning',
          });
          if (!ok) return;
        }
        const next = normalizeDrawState(tournamentDrawStateFromTemplate(result.doc, clubSheets));
        await persist(next);
        setSelectedGameId(null);
        setSelectedTextNodeId(null);
        selectWorkspaceTabReplaceHash('structure');
        showAlert('Draw template imported.', 'success');
      } catch (err) {
        showAlert(formatApiError(err, 'Failed to import draw'), 'error');
      }
    },
    [
      draw,
      clubSheets,
      confirm,
      persist,
      selectWorkspaceTabReplaceHash,
      showAlert,
    ],
  );

  const save = async () => {
    if (!draw) return;
    try {
      await persist(draw);
    } catch (err) {
      window.alert(formatApiError(err, 'Failed to save draw'));
    }
  };

  const updateDraw = useCallback(
    (fn: (d: TournamentDrawState) => TournamentDrawState, opts?: { markDirty?: boolean }) => {
      setDraw((d) => {
        if (!d) return d;
        const next = fn(d);
        if (opts?.markDirty !== false) setDirty(true);
        return next;
      });
    },
    [],
  );

  const flushGameResultPatch = useCallback(
    async (gameId: string, result: TournamentGameResult | null) => {
      try {
        await api.patch(`/events/${eventId}/tournament-draw/games/${encodeURIComponent(gameId)}/result`, {
          result,
        });
      } catch (err) {
        setDirty(true);
        window.alert(formatApiError(err, 'Failed to save game result'));
      }
    },
    [eventId],
  );

  const updateDrawForResults = useCallback(
    (
      fn: (d: TournamentDrawState) => TournamentDrawState,
      opts?: { persistGameResult?: { gameId: string; result: TournamentGameResult | null } },
    ) => {
      setDraw((d) => {
        if (!d) return d;
        const next = fn(d);
        drawRef.current = next;
        return next;
      });
      const patch = opts?.persistGameResult;
      if (!patch) return;
      const { gameId, result } = patch;
      const timers = resultPatchTimersRef.current;
      if (timers[gameId]) {
        clearTimeout(timers[gameId]);
      }
      timers[gameId] = setTimeout(() => {
        delete timers[gameId];
        void flushGameResultPatch(gameId, result);
      }, 350);
    },
    [flushGameResultPatch],
  );

  const openBracketEventsModal = useCallback(() => {
    if (!draw) return;
    bracketEventsModalSessionRef.current = {
      events: structuredClone(draw.setup.events),
      eventCount: draw.setup.eventCount,
      hadDirtyOnOpen: dirty,
    };
    setBracketEventsModalOpen(true);
  }, [draw, dirty]);

  const cancelBracketEventsModal = useCallback(() => {
    const session = bracketEventsModalSessionRef.current;
    bracketEventsModalSessionRef.current = null;
    if (session) {
      setDraw((d) => {
        if (!d) return d;
        return {
          ...d,
          setup: {
            ...d.setup,
            events: structuredClone(session.events),
            eventCount: session.eventCount,
          },
        };
      });
      setDirty(session.hadDirtyOnOpen);
    }
    setBracketEventsModalOpen(false);
  }, []);

  const confirmBracketEventsModal = useCallback(() => {
    bracketEventsModalSessionRef.current = null;
    setBracketEventsModalOpen(false);
  }, []);

  const createBlankDraw = async () => {
    let club = clubSheets;
    if (club.length === 0) {
      try {
        const r = await api.get<ClubSheet[]>(`/sheets`);
        club = r.data ?? [];
        if (club.length > 0) setClubSheets(club);
      } catch {
        /* sheets optional */
      }
    }
    const next: TournamentDrawState = {
      ...emptyTournamentDraw(4),
      sheets: club.length > 0 ? sheetsFromClubSheets(club) : [],
    };
    setDraw(normalizeDrawState(next));
    setDirty(true);
    selectWorkspaceTabReplaceHash('structure');
  };

  const selectedGame = draw && selectedGameId ? draw.games[selectedGameId] : undefined;
  const selectedTextNode =
    draw && selectedTextNodeId ? draw.textNodes.find((t) => t.id === selectedTextNodeId) : undefined;

  const slotOptions: ChoiceOption<string>[] = useMemo(() => {
    if (!draw) return [];
    const opts: ChoiceOption<string>[] = [
      { value: encodeSlotSource({ sourceType: 'tbd' }), label: 'TBD' },
      { value: encodeSlotSource({ sourceType: 'bye' }), label: 'Bye' },
    ];
    for (const t of [...teams].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
      opts.push({
        value: encodeSlotSource({ sourceType: 'team', teamId: t.id }),
        label: formatTeamDisplayName(t.teamName, t.sortOrder),
      });
    }
    for (const g of Object.values(draw.games)) {
      const k = g.slots.length;
      for (let p = 1; p <= k; p++) {
        if (selectedGameId && g.id === selectedGameId) continue;
        const label =
          k <= 2
            ? p === 1
              ? `Winner of ${g.label}`
              : `Loser of ${g.label}`
            : `${ordinalPlaceLabel(p)} of ${g.label}`;
        opts.push({
          value: encodeSlotSource({ sourceType: 'game_place', gameId: g.id, place: p }),
          label,
        });
      }
    }
    return opts;
  }, [draw, teams, selectedGameId]);

  const routingGameOptions: ChoiceOption<string>[] = useMemo(() => {
    if (!draw) return [{ value: '', label: 'Select game…' }];
    return [
      { value: '', label: 'Select game…' },
      ...Object.values(draw.games)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((g) => ({ value: g.id, label: g.label })),
    ];
  }, [draw]);

  const addGame = () => {
    if (!draw || draw.setup.events.length === 0) return;
    const sortedEvents = [...draw.setup.events].sort((a, b) => a.order - b.order);
    const defaultEventId = sortedEvents[0]!.id;
    const fromRef = lastInteractedGameEventIdRef.current;
    const eventId =
      fromRef && sortedEvents.some((e) => e.id === fromRef) ? fromRef : defaultEventId;
    const ev = draw.setup.events.find((e) => e.id === eventId);
    if (!ev) return;
    const laneGames = Object.values(draw.games).filter((g) => g.eventId === eventId);
    const maxDepth = laneGames.length ? Math.max(...laneGames.map((g) => g.depth)) : 0;
    const atDepth = maxDepth;
    const atCol = laneGames.filter((g) => g.depth === atDepth);
    const nextVo = atCol.length === 0 ? 0 : Math.max(...atCol.map((g) => g.verticalOrder)) + 1;
    const label = nextLabelInLane(draw.games, eventId, ev.code);
    const id = crypto.randomUUID();
    const game: TournamentGameNode = {
      id,
      eventId,
      label,
      depth: atDepth,
      verticalOrder: nextVo,
      slots: [{ sourceType: 'tbd' }, { sourceType: 'tbd' }],
    };
    updateDraw((d) => ({
      ...d,
      games: { ...d.games, [id]: game },
      connections: [
        ...d.connections,
        {
          id: crypto.randomUUID(),
          fromGameId: id,
          place: 2,
          terminalType: 'tbd',
        },
      ],
    }));
    setSelectedTextNodeId(null);
    setSelectedGameId(id);
  };

  const addTextNode = () => {
    if (!draw) return;
    const id = crypto.randomUUID();
    const node: TournamentTextNode = {
      id,
      text: 'Note',
      width: 168,
      height: 72,
      x: 48,
      y: 48,
      anchorKind: 'none',
      anchorGameId: null,
      anchorConnectionId: null,
      offsetX: 0,
      offsetY: 0,
      showConnector: false,
      connectorLineStyle: 'solid',
      connectorColor: '#64748b',
    };
    updateDraw((d) => ({ ...d, textNodes: [...d.textNodes, node] }));
    setSelectedGameId(null);
    setSelectedTextNodeId(id);
  };

  const deleteSelection = () => {
    if (!draw) return;
    if (selectedTextNodeId) {
      const tid = selectedTextNodeId;
      updateDraw((d) => ({ ...d, textNodes: d.textNodes.filter((t) => t.id !== tid) }));
      setSelectedTextNodeId(null);
      return;
    }
    if (!selectedGameId) return;
    const id = selectedGameId;
    const positions = layoutDraw(draw).positions;
    updateDraw((d) => {
      const removedConnIds = new Set(
        d.connections.filter((c) => c.fromGameId === id || c.toGameId === id).map((c) => c.id),
      );
      const games = { ...d.games };
      delete games[id];
      const connections = d.connections.filter((c) => c.fromGameId !== id && c.toGameId !== id);
      const cleaned = Object.fromEntries(
        Object.entries(games).map(([k, g]) => {
          const fix = (s: TournamentSlotSource) => {
            if (s.sourceType === 'game_place' && s.gameId === id) {
              return { sourceType: 'tbd' as const };
            }
            return s;
          };
          return [k, { ...g, slots: g.slots.map(fix) }];
        }),
      );
      const textNodes = d.textNodes.map((tn) => {
        if (tn.anchorKind === 'game' && tn.anchorGameId === id) {
          const box = resolveTextNodeLayout(tn, positions).box;
          return {
            ...tn,
            anchorKind: 'none' as const,
            anchorGameId: null,
            anchorConnectionId: null,
            x: box.x,
            y: box.y,
            offsetX: 0,
            offsetY: 0,
          };
        }
        if (
          tn.anchorKind === 'virtual' &&
          tn.anchorConnectionId &&
          removedConnIds.has(tn.anchorConnectionId)
        ) {
          const box = resolveTextNodeLayout(tn, positions).box;
          return {
            ...tn,
            anchorKind: 'none' as const,
            anchorGameId: null,
            anchorConnectionId: null,
            x: box.x,
            y: box.y,
            offsetX: 0,
            offsetY: 0,
          };
        }
        return tn;
      });
      return { ...d, games: cleaned, connections, textNodes };
    });
    setSelectedGameId(null);
  };

  if (loading) {
    return <InlineStateMessage tone="neutral" title="Loading draw…" description="" />;
  }

  if (loadError) {
    return (
      <InlineStateMessage
        tone="error"
        title="Could not load draw"
        description={loadError}
        action={
          <Button type="button" variant="secondary" onClick={load}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <>
      {!draw ? (
        <div className="space-y-4">
          <InlineStateMessage
            tone="neutral"
            title="No tournament draw yet"
            description="Create a blank draw with four event lanes (A–D). Then use Structure to build games, assign teams from the roster, and set draw times and sheets here on Setup."
          />
          <Button type="button" variant="primary" onClick={() => void createBlankDraw()}>
            Create draw
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
      <input
        id={importTemplateInputId}
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import tournament draw template JSON file"
        onChange={onImportTemplateFileChange}
      />
      <PageTabs
        items={[
          {
            key: 'setup',
            label: 'Setup',
            isActive: workspaceTab === 'setup',
            onClick: () => selectWorkspaceTabFromUserClick('setup'),
          },
          {
            key: 'structure',
            label: 'Structure',
            isActive: workspaceTab === 'structure',
            onClick: () => selectWorkspaceTabFromUserClick('structure'),
          },
          {
            key: 'results',
            label: 'Results',
            isActive: workspaceTab === 'results',
            onClick: () => selectWorkspaceTabFromUserClick('results'),
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          {workspaceTab !== 'results' && (dirty || saving) ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {dirty ? 'Unsaved changes' : ''}
              {dirty && saving ? ' · ' : ''}
              {saving ? 'Saving…' : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {workspaceTab !== 'results' ? (
            <Button type="button" variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
              Save draw
            </Button>
          ) : null}
        </div>
      </div>

      {workspaceTab === 'setup' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <TournamentDrawBlocksSection draw={draw} updateDraw={updateDraw} />
          <TournamentSheetsSection draw={draw} updateDraw={updateDraw} clubSheets={clubSheets} />
        </div>
      )}

      {workspaceTab === 'structure' && layout && (
        <div
          className={
            structureFullWindow
              ? 'fixed inset-0 z-[100] flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950'
              : 'grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_22rem]'
          }
        >
          {structureFullWindow ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6">
              <span className="font-semibold text-gray-900 dark:text-gray-100">Bracket builder</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                >
                  {saving ? 'Saving…' : 'Save draw'}
                </Button>
                <div className="relative inline-block" ref={fullWindowMoreMenuRef}>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 w-10 shrink-0 !p-0"
                    aria-label="More bracket actions"
                    aria-expanded={fullWindowMoreMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => {
                      setFullWindowMoreMenuOpen((o) => !o);
                      setStructureToolbarAddMenuOpen(false);
                      setStructureToolbarMoreMenuOpen(false);
                    }}
                  >
                    <HiEllipsisHorizontal className="h-5 w-5" aria-hidden />
                  </Button>
                  {fullWindowMoreMenuOpen ? (
                    <div
                      className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        onClick={() => {
                          setFullWindowMoreMenuOpen(false);
                          openBracketEventsModal();
                        }}
                      >
                        Configure events
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        onClick={() => {
                          setFullWindowMoreMenuOpen(false);
                          const doc = buildTournamentDrawTemplate(draw, teams);
                          downloadTournamentDrawTemplate(
                            doc,
                            exportTemplateFilenameBase.trim() || `event-${eventId}`,
                          );
                        }}
                      >
                        Export template
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        onClick={() => {
                          setFullWindowMoreMenuOpen(false);
                          openImportTemplatePicker();
                        }}
                      >
                        Import template
                      </button>
                    </div>
                  ) : null}
                </div>
                <Button type="button" variant="secondary" onClick={() => setStructureFullWindow(false)}>
                  Exit full window
                </Button>
              </div>
            </div>
          ) : null}
          <div
            className={
              structureFullWindow
                ? 'flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4 pt-2 sm:px-6 xl:flex-row xl:gap-4'
                : 'contents'
            }
          >
            <FormSection
              title="Bracket setup"
              surface="panel"
              className={
                structureFullWindow
                  ? 'flex min-h-0 min-w-0 flex-1 flex-col space-y-5 overflow-hidden xl:min-h-0'
                  : undefined
              }
            >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div ref={structureToolbarAddMenuRef} className="inline-flex">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 rounded-r-none border-r border-white/25 pr-3"
                  onClick={() => {
                    setStructureToolbarAddMenuOpen(false);
                    addGame();
                  }}
                >
                  Add game
                </Button>
                <div className="relative inline-flex">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 rounded-l-none px-2.5"
                    aria-label="More add options"
                    aria-expanded={structureToolbarAddMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => {
                      setStructureToolbarAddMenuOpen((o) => !o);
                      setStructureToolbarMoreMenuOpen(false);
                      setFullWindowMoreMenuOpen(false);
                    }}
                  >
                    <HiChevronDown className="h-4 w-4" aria-hidden />
                  </Button>
                  {structureToolbarAddMenuOpen ? (
                    <div
                      className="absolute left-0 top-full z-50 mt-1 w-max min-w-[12rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        onClick={() => {
                          setStructureToolbarAddMenuOpen(false);
                          addTextNode();
                        }}
                      >
                        Add text note
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              {selectedGameId || selectedTextNodeId ? (
                <Button
                  type="button"
                  variant="outline-danger"
                  className="h-10 w-10 shrink-0 !p-0"
                  aria-label="Delete selected"
                  title="Delete selected"
                  onClick={deleteSelection}
                >
                  <HiTrash className="h-5 w-5" aria-hidden />
                </Button>
              ) : null}
              <div className="min-w-[0.5rem] flex-1" aria-hidden />
              <Button
                type="button"
                variant="secondary"
                className="h-10 gap-2"
                onClick={() => bracketView.resetView()}
              >
                <HiArrowUturnLeft className="h-4 w-4 shrink-0" aria-hidden />
                Reset view
              </Button>
              {!structureFullWindow ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 w-10 shrink-0 !p-0"
                  title="Toggle fullscreen (F)"
                  aria-label="Toggle fullscreen (F)"
                  onClick={() => setStructureFullWindow(true)}
                >
                  <HiArrowsPointingOut className="h-5 w-5" aria-hidden />
                </Button>
              ) : null}
              <div className="relative inline-block" ref={structureToolbarMoreMenuRef}>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 w-10 shrink-0 !p-0"
                  aria-label="More bracket actions"
                  aria-expanded={structureToolbarMoreMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setStructureToolbarMoreMenuOpen((o) => !o);
                    setStructureToolbarAddMenuOpen(false);
                    setFullWindowMoreMenuOpen(false);
                  }}
                >
                  <HiEllipsisHorizontal className="h-5 w-5" aria-hidden />
                </Button>
                {structureToolbarMoreMenuOpen ? (
                  <div
                    className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={() => {
                        setStructureToolbarMoreMenuOpen(false);
                        openBracketEventsModal();
                      }}
                    >
                      Configure events
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={() => {
                        setStructureToolbarMoreMenuOpen(false);
                        const doc = buildTournamentDrawTemplate(draw, teams);
                        downloadTournamentDrawTemplate(
                          doc,
                          exportTemplateFilenameBase.trim() || `event-${eventId}`,
                        );
                      }}
                    >
                      Export template
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={() => {
                        setStructureToolbarMoreMenuOpen(false);
                        openImportTemplatePicker();
                      }}
                    >
                      Import template
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div
              ref={bracketView.canvasShellRef}
              className={
                structureFullWindow
                  ? 'relative min-h-0 flex-1 select-none [&_*]:select-none overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/40'
                  : 'relative min-h-[20rem] h-[calc(100dvh-18rem)] max-h-[calc(100dvh-9rem)] select-none [&_*]:select-none overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/40'
              }
            >
              <div
                role="application"
                aria-label="Tournament bracket canvas"
                className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
                onPointerDown={bracketView.beginCanvasPan}
              >
                <div
                  style={{
                    transform: `translate(${bracketView.displayPan.x}px, ${bracketView.displayPan.y}px) scale(${bracketView.zoom})`,
                    transformOrigin: '0 0',
                    width: layout.width,
                    minHeight: layout.height,
                    position: 'relative',
                  }}
                >
                  <TournamentDrawBracketScene
                    draw={draw}
                    layout={layout}
                    edgePaths={edgePaths}
                    textConnectorPaths={textConnectorPaths}
                    teamsById={teamsById}
                    emptyLaneLabel="Empty lane — add a game"
                    interactive
                    selectedGameId={selectedGameId}
                    selectedTextNodeId={selectedTextNodeId}
                    onSelectGame={(id) => {
                      setSelectedTextNodeId(null);
                      setSelectedGameId(id);
                    }}
                    onSelectTextNode={(id) => {
                      setSelectedGameId(null);
                      setSelectedTextNodeId(id);
                    }}
                    viewZoom={bracketView.zoom}
                    updateDraw={(fn) => updateDraw(fn)}
                  />
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Inspector"
            description="Properties for the selected game or text note."
            surface="panel"
            className={
              structureFullWindow
                ? 'flex w-full min-h-0 flex-col overflow-y-auto xl:w-[22rem] xl:max-w-[26rem] xl:shrink-0'
                : undefined
            }
          >
            {!selectedGame && !selectedTextNode ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Select a game or text note on the canvas.
              </p>
            ) : selectedTextNode ? (
              <TextNodeInspectorPanel
                draw={draw}
                textNode={selectedTextNode}
                updateDraw={updateDraw}
                onDeleted={() => setSelectedTextNodeId(null)}
              />
            ) : (
              <InspectorPanel
                draw={draw}
                selectedGame={selectedGame!}
                updateDraw={updateDraw}
                slotOptions={slotOptions}
                routingGameOptions={routingGameOptions}
              />
            )}
          </FormSection>
          </div>
        </div>
      )}

      {workspaceTab === 'results' && (
        <AdminTournamentDrawResultsTab draw={draw} teams={teams} updateDraw={updateDrawForResults} />
      )}

      {draw ? (
        <Modal
          isOpen={bracketEventsModalOpen}
          onClose={cancelBracketEventsModal}
          title="Configure events"
          size="lg"
          verticalAlign="start"
        >
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Order is top to bottom on the canvas. The short code is used for new game labels (e.g. A1). Use the drag handle to reorder; you can also use the keyboard when the handle is focused.
          </p>
          <SortableList
            items={sortedBracketEvents(draw.setup.events)}
            getId={(ev) => ev.id}
            getItemLabel={(ev) => `${ev.code}: ${ev.name}`}
            itemNoun="bracket event"
            onReorder={(nextItems) => {
              updateDraw((d) => ({
                ...d,
                setup: {
                  ...d.setup,
                  eventCount: nextItems.length,
                  events: nextItems.map((e, i) => ({ ...e, order: i })),
                },
              }));
            }}
            renderItem={({ item: ev, dragHandle, isDragging, isOverlay }) => (
              <SortableRow
                isDragging={isDragging}
                isOverlay={isOverlay}
                className="space-y-3 border-gray-200/90 bg-transparent dark:border-gray-700/90"
              >
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex shrink-0 items-center pb-0.5">{dragHandle}</div>
                  <span
                    className="mb-2 h-8 w-2 shrink-0 self-end rounded-sm"
                    style={{ backgroundColor: ev.color }}
                    aria-hidden
                  />
                  <FormField
                    label="Name"
                    htmlFor={`${bracketEventsListId}-${ev.id}-name`}
                    className="min-w-[10rem] flex-1"
                  >
                    <input
                      id={`${bracketEventsListId}-${ev.id}-name`}
                      className="app-input w-full"
                      value={ev.name}
                      maxLength={120}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const name = raw.trim() === '' ? 'Event' : raw;
                        updateDraw((d) => ({
                          ...d,
                          setup: {
                            ...d.setup,
                            events: d.setup.events.map((row) =>
                              row.id === ev.id ? { ...row, name } : row,
                            ),
                          },
                        }));
                      }}
                    />
                  </FormField>
                  <FormField
                    label="Code"
                    htmlFor={`${bracketEventsListId}-${ev.id}-code`}
                    className="w-[5.5rem] shrink-0"
                  >
                    <input
                      id={`${bracketEventsListId}-${ev.id}-code`}
                      className="app-input w-full font-mono"
                      value={ev.code}
                      maxLength={8}
                      onChange={(e) => {
                        const raw = e.target.value.slice(0, 8);
                        const code = raw.trim() === '' ? ev.code : raw;
                        updateDraw((d) => ({
                          ...d,
                          setup: {
                            ...d.setup,
                            events: d.setup.events.map((row) =>
                              row.id === ev.id ? { ...row, code } : row,
                            ),
                          },
                        }));
                      }}
                    />
                  </FormField>
                </div>
              </SortableRow>
            )}
          />
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <Button type="button" variant="secondary" onClick={cancelBracketEventsModal}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={confirmBracketEventsModal}>
              Confirm
            </Button>
          </div>
        </Modal>
      ) : null}
        </div>
      )}
    </>
  );
}

function isRenderableOption(o: ChoiceOption<string>): o is ChoiceRenderableOption<string> {
  return (o as { type?: string }).type !== 'divider';
}

type TextNodeInspectorPanelProps = {
  draw: TournamentDrawState;
  textNode: TournamentTextNode;
  updateDraw: (fn: (d: TournamentDrawState) => TournamentDrawState, opts?: { markDirty?: boolean }) => void;
  onDeleted: () => void;
};

function TextNodeInspectorPanel({ draw, textNode, updateDraw, onDeleted }: TextNodeInspectorPanelProps) {
  const bodyId = useId();
  const wId = useId();
  const hId = useId();
  const lineColorId = useId();

  const anchorSummary = useMemo(() => {
    if (textNode.anchorKind === 'none') return 'Free-floating (stored as x/y in layout space).';
    if (textNode.anchorKind === 'game' && textNode.anchorGameId) {
      const g = draw.games[textNode.anchorGameId];
      return g ? `Anchored to game ${g.label} (offsets from that card’s top-left).` : 'Anchored to a missing game.';
    }
    if (textNode.anchorKind === 'virtual' && textNode.anchorConnectionId) {
      return 'Anchored to a cross-event virtual feeder card (offsets from that card’s top-left).';
    }
    return 'Anchor';
  }, [draw.games, textNode]);

  const clearAnchor = () => {
    updateDraw((d) => {
      const tn = d.textNodes.find((t) => t.id === textNode.id);
      if (!tn) return d;
      const positions = layoutDraw(d).positions;
      const curBox = resolveTextNodeLayout(tn, positions).box;
      return {
        ...d,
        textNodes: d.textNodes.map((t) =>
          t.id !== textNode.id
            ? t
            : {
                ...t,
                anchorKind: 'none',
                anchorGameId: null,
                anchorConnectionId: null,
                x: curBox.x,
                y: curBox.y,
                offsetX: 0,
                offsetY: 0,
              },
        ),
      };
    });
  };

  const colorPickerValue =
    textNode.connectorColor && /^#[0-9a-fA-F]{6}$/.test(textNode.connectorColor.trim())
      ? textNode.connectorColor.trim()
      : '#64748b';

  return (
    <div className="space-y-4">
      <FormField label="Text" htmlFor={bodyId}>
        <textarea
          id={bodyId}
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          rows={4}
          value={textNode.text}
          onChange={(e) => {
            const v = e.target.value;
            updateDraw((d) => ({
              ...d,
              textNodes: d.textNodes.map((t) => (t.id === textNode.id ? { ...t, text: v } : t)),
            }));
          }}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Width (px)" htmlFor={wId}>
          <input
            id={wId}
            type="number"
            min={20}
            max={2000}
            className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={textNode.width}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n)) return;
              updateDraw((d) => ({
                ...d,
                textNodes: d.textNodes.map((t) =>
                  t.id === textNode.id ? { ...t, width: Math.min(2000, Math.max(20, n)) } : t,
                ),
              }));
            }}
          />
        </FormField>
        <FormField label="Height (px)" htmlFor={hId}>
          <input
            id={hId}
            type="number"
            min={16}
            max={2000}
            className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={textNode.height}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n)) return;
              updateDraw((d) => ({
                ...d,
                textNodes: d.textNodes.map((t) =>
                  t.id === textNode.id ? { ...t, height: Math.min(2000, Math.max(16, n)) } : t,
                ),
              }));
            }}
          />
        </FormField>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400">{anchorSummary}</p>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
        <input
          type="checkbox"
          className="rounded border-gray-300 dark:border-gray-600"
          checked={textNode.showConnector}
          onChange={(e) =>
            updateDraw((d) => ({
              ...d,
              textNodes: d.textNodes.map((t) =>
                t.id === textNode.id ? { ...t, showConnector: e.target.checked } : t,
              ),
            }))
          }
        />
        Draw line to anchor (when anchored)
      </label>
      <FormField label="Line color" htmlFor={lineColorId}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={lineColorId}
            type="color"
            className="h-9 w-12 cursor-pointer rounded border border-gray-200 bg-white p-0.5 dark:border-gray-600"
            value={colorPickerValue}
            onChange={(e) => {
              const hex = e.target.value;
              updateDraw((d) => ({
                ...d,
                textNodes: d.textNodes.map((t) =>
                  t.id === textNode.id ? { ...t, connectorColor: hex } : t,
                ),
              }));
            }}
          />
          <input
            type="text"
            className="min-w-[7rem] flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={textNode.connectorColor ?? ''}
            placeholder="#64748b"
            onChange={(e) => {
              const raw = e.target.value.trim();
              updateDraw((d) => ({
                ...d,
                textNodes: d.textNodes.map((t) =>
                  t.id === textNode.id ? { ...t, connectorColor: raw || undefined } : t,
                ),
              }));
            }}
          />
        </div>
      </FormField>
      {textNode.anchorKind !== 'none' ? (
        <Button type="button" variant="secondary" onClick={clearAnchor}>
          Detach anchor (keep position)
        </Button>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          updateDraw((d) => ({ ...d, textNodes: d.textNodes.filter((t) => t.id !== textNode.id) }));
          onDeleted();
        }}
      >
        Delete text note
      </Button>
    </div>
  );
}

type InspectorPanelProps = {
  draw: TournamentDrawState;
  selectedGame: TournamentGameNode;
  updateDraw: (fn: (d: TournamentDrawState) => TournamentDrawState, opts?: { markDirty?: boolean }) => void;
  slotOptions: ChoiceOption<string>[];
  routingGameOptions: ChoiceOption<string>[];
};

function InspectorPanel({
  draw,
  selectedGame,
  updateDraw,
  slotOptions,
  routingGameOptions,
}: InspectorPanelProps) {
  const labelId = useId();
  const eventLaneId = useId();
  const depthId = useId();
  const voId = useId();
  const slotFieldBase = useId();
  const schedDrawId = useId();
  const schedSheetId = useId();
  const routeFieldBase = useId();

  const drawBlockOptions: ChoiceOption<string>[] = useMemo(() => {
    const base: ChoiceOption<string>[] = [{ value: '__none', label: 'Not set' }];
    const blocks = [...draw.drawBlocks].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const selDraw = selectedGame.schedule?.drawBlockId;
    if (selDraw && !blocks.some((b) => b.id === selDraw)) {
      base.push({ value: selDraw, label: 'Unknown draw — fix in Setup' });
    }
    for (const b of blocks) {
      base.push({ value: b.id, label: formatDrawBlockOptionLabel(b) });
    }
    return base;
  }, [draw.drawBlocks, selectedGame.schedule?.drawBlockId]);

  const sheetOptions: ChoiceOption<string>[] = useMemo(() => {
    const base: ChoiceOption<string>[] = [{ value: '__none', label: 'Not set' }];
    const sheets = [...draw.sheets].sort((a, b) => a.order - b.order || a.clubSheetId - b.clubSheetId);
    const selSheet = selectedGame.schedule?.sheetId;
    if (selSheet != null && !sheets.some((s) => s.clubSheetId === selSheet)) {
      base.push({ value: String(selSheet), label: `Unknown sheet (${selSheet})` });
    }
    for (const s of sheets) {
      base.push({ value: String(s.clubSheetId), label: s.name });
    }
    return base;
  }, [draw.sheets, selectedGame.schedule?.sheetId]);

  const incomingGameFeeders = useMemo(
    () => incomingGameFeedersSorted(draw, selectedGame.id),
    [draw, selectedGame.id],
  );

  const k = selectedGame.slots.length;

  /** Slots filled by incoming bracket routes into this game (same ordering as the game card). */
  const bracketLockedSlotCount = useMemo(
    () => Math.min(incomingGameFeeders.length, k),
    [incomingGameFeeders.length, k],
  );

  const competitorSlotsHelp = useMemo(() => {
    if (incomingGameFeeders.length === 0) {
      return 'Set who plays in this game (teams, byes, or finishes from other games).';
    }
    if (bracketLockedSlotCount === k && k > 0) {
      return 'Competitors are determined by routes from other games into this match (including bracket finals). Those entries cannot be changed here. Use Add competitor if this game should include an additional entry.';
    }
    return 'The first competitor slot(s) are set by bracket routes into this game and cannot be changed here. Set any remaining entries below.';
  }, [incomingGameFeeders.length, k, bracketLockedSlotCount]);

  const connectionForPlace = useCallback(
    (place: number) =>
      draw.connections.find((c) => c.fromGameId === selectedGame.id && c.place === place),
    [draw.connections, selectedGame.id],
  );

  const addCompetitor = () => {
    updateDraw((d) => {
      const g = d.games[selectedGame.id]!;
      if (g.slots.length >= 32) return d;
      const nextSlots = [...g.slots, { sourceType: 'tbd' as const }];
      const newPlace = nextSlots.length;
      return {
        ...d,
        games: { ...d.games, [selectedGame.id]: { ...g, slots: nextSlots } },
        connections: [
          ...d.connections,
          {
            id: crypto.randomUUID(),
            fromGameId: selectedGame.id,
            place: newPlace,
            terminalType: 'tbd' as const,
          },
        ],
      };
    });
  };

  const removeLastCompetitor = () => {
    updateDraw((d) => {
      const g = d.games[selectedGame.id]!;
      if (g.slots.length <= 2) return d;
      const removedPlace = g.slots.length;
      const nextSlots = g.slots.slice(0, -1);
      let games: Record<string, TournamentGameNode> = { ...d.games };
      games[selectedGame.id] = { ...g, slots: nextSlots };
      for (const [gid, gg] of Object.entries(games)) {
        games[gid] = {
          ...gg,
          slots: gg.slots.map((s) => {
            if (s.sourceType === 'game_place' && s.gameId === selectedGame.id && s.place === removedPlace) {
              return { sourceType: 'tbd' as const };
            }
            return s;
          }),
        };
      }
      const connections = d.connections.filter(
        (c) => !(c.fromGameId === selectedGame.id && c.place === removedPlace),
      );
      return { ...d, games, connections };
    });
  };

  const eventLaneOptions: ChoiceOption<string>[] = useMemo(
    () =>
      [...draw.setup.events]
        .sort((a, b) => a.order - b.order)
        .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}` })),
    [draw.setup.events],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <FormField label="Event" htmlFor={eventLaneId}>
          <ChoiceInput<string>
            inputId={eventLaneId}
            listboxLabel="Event lane for this game"
            options={eventLaneOptions}
            value={selectedGame.eventId}
            onChange={(v) => {
              if (v == null || Array.isArray(v)) return;
              updateDraw((d) => ({
                ...d,
                games: {
                  ...d.games,
                  [selectedGame.id]: { ...d.games[selectedGame.id]!, eventId: v },
                },
              }));
            }}
          />
        </FormField>
        <FormField label="Label" htmlFor={labelId}>
          <input
            id={labelId}
            className="app-input w-full"
            value={selectedGame.label}
            onChange={(e) => {
              const v = e.target.value;
              updateDraw((d) => ({
                ...d,
                games: {
                  ...d.games,
                  [selectedGame.id]: { ...d.games[selectedGame.id]!, label: v },
                },
              }));
            }}
          />
        </FormField>
      </div>
      <div
        className={
          incomingGameFeeders.length > 0 ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-2'
        }
      >
        <FormField label="Depth" htmlFor={depthId}>
          <input
            id={depthId}
            type="number"
            min={0}
            className="app-input w-full"
            value={selectedGame.depth}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n) || n < 0) return;
              updateDraw((d) => ({
                ...d,
                games: {
                  ...d.games,
                  [selectedGame.id]: { ...d.games[selectedGame.id]!, depth: n },
                },
              }));
            }}
          />
        </FormField>
        {incomingGameFeeders.length === 0 ? (
          <FormField label="Vertical order" htmlFor={voId}>
            <input
              id={voId}
              type="number"
              min={0}
              className="app-input w-full"
              value={selectedGame.verticalOrder}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(n) || n < 0) return;
                updateDraw((d) => ({
                  ...d,
                  games: {
                    ...d.games,
                    [selectedGame.id]: { ...d.games[selectedGame.id]!, verticalOrder: n },
                  },
                }));
              }}
            />
          </FormField>
        ) : null}
      </div>
      <div className="space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-400">{competitorSlotsHelp}</p>
        {selectedGame.slots.map((slot, idx) => {
          const fromBracket = idx < bracketLockedSlotCount;
          if (fromBracket) {
            const edge = incomingGameFeeders[idx];
            const from = edge ? draw.games[edge.fromGameId] : undefined;
            const line =
              from && edge ? formatFeederPipeLabel(from, edge.place) : '—';
            return (
              <div
                key={`slot-${idx}`}
                className="rounded-md border border-gray-200 bg-gray-50/80 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800/40"
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">Competitor {idx + 1}</span>
                <span className="text-gray-500 dark:text-gray-400"> · </span>
                <span className="text-gray-800 dark:text-gray-200">{line}</span>
              </div>
            );
          }
          return (
            <FormField
              key={`slot-${idx}`}
              label={`Competitor entry ${idx + 1}`}
              htmlFor={`${slotFieldBase}-${idx}`}
            >
              <ChoiceInput<string>
                inputId={`${slotFieldBase}-${idx}`}
                listboxLabel={`Competitor entry ${idx + 1}`}
                options={slotOptions}
                value={encodeSlotSource(slot)}
                onChange={(v) => {
                  if (v == null || Array.isArray(v)) return;
                  updateDraw((d) => {
                    const g = d.games[selectedGame.id]!;
                    const nextSlots = [...g.slots];
                    nextSlots[idx] = decodeSlotSource(v);
                    return {
                      ...d,
                      games: {
                        ...d.games,
                        [selectedGame.id]: { ...g, slots: nextSlots },
                      },
                    };
                  });
                }}
              />
            </FormField>
          );
        })}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            className="text-sm font-medium text-primary-teal hover:underline dark:text-teal-400"
            onClick={addCompetitor}
            disabled={k >= 32}
          >
            Add competitor
          </button>
          {k > 2 ? (
            <button
              type="button"
              className="text-sm font-medium text-gray-600 hover:underline dark:text-gray-400"
              onClick={removeLastCompetitor}
            >
              Remove last competitor
            </button>
          ) : null}
        </div>
      </div>
      <div className="border-t border-gray-200 dark:border-gray-600 pt-3 space-y-3">
        <p className="app-section-title text-sm">Schedule</p>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Draw times are listed under Setup. Choose a draw and sheet for this game.
        </p>
        <FormField label="Draw time" htmlFor={schedDrawId}>
          <ChoiceInput<string>
            inputId={schedDrawId}
            listboxLabel="Draw time"
            options={drawBlockOptions}
            value={selectedGame.schedule?.drawBlockId ? selectedGame.schedule.drawBlockId : '__none'}
            onChange={(v) => {
              if (v == null || Array.isArray(v)) return;
              updateDraw((d) => {
                const sch = { ...d.games[selectedGame.id]?.schedule };
                if (v === '__none') {
                  return {
                    ...d,
                    games: {
                      ...d.games,
                      [selectedGame.id]: {
                        ...d.games[selectedGame.id]!,
                        schedule: { ...sch, drawBlockId: null },
                      },
                    },
                  };
                }
                const blk = d.drawBlocks.find((x) => x.id === v);
                return {
                  ...d,
                  games: {
                    ...d.games,
                    [selectedGame.id]: {
                      ...d.games[selectedGame.id]!,
                      schedule: {
                        ...sch,
                        drawBlockId: v,
                        startTime: blk?.startTime ?? sch.startTime ?? null,
                      },
                    },
                  },
                };
              });
            }}
          />
        </FormField>
        <FormField label="Sheet" htmlFor={schedSheetId}>
          <ChoiceInput<string>
            inputId={schedSheetId}
            listboxLabel="Sheet"
            options={sheetOptions}
            value={
              selectedGame.schedule?.sheetId != null ? String(selectedGame.schedule.sheetId) : '__none'
            }
            onChange={(v) => {
              if (v == null || Array.isArray(v)) return;
              updateDraw((d) => {
                const sch = { ...d.games[selectedGame.id]?.schedule };
                if (v === '__none') {
                  return {
                    ...d,
                    games: {
                      ...d.games,
                      [selectedGame.id]: {
                        ...d.games[selectedGame.id]!,
                        schedule: { ...sch, sheetId: null, sheetLabel: null },
                      },
                    },
                  };
                }
                const sid = Number.parseInt(v, 10);
                const row = d.sheets.find((s) => s.clubSheetId === sid);
                return {
                  ...d,
                  games: {
                    ...d.games,
                    [selectedGame.id]: {
                      ...d.games[selectedGame.id]!,
                      schedule: {
                        ...sch,
                        sheetId: sid,
                        sheetLabel: row?.name ?? null,
                      },
                    },
                  },
                };
              });
            }}
          />
        </FormField>
      </div>
      <div className="border-t border-gray-200 dark:border-gray-600 pt-3 space-y-3">
        <p className="app-section-title text-sm">Routing (outputs)</p>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Each finish position has one route. With two competitors, use winner and loser; with three or more, routes are
          labeled 1st, 2nd, 3rd, etc.
        </p>
        {Array.from({ length: k }, (_, i) => i + 1).map((place) => {
          const conn = connectionForPlace(place);
          const label = outputRoutingLabel(place, k);
          return (
            <FormField key={`route-${place}`} label={label} htmlFor={`${routeFieldBase}-${place}`}>
              <ChoiceInput<string>
                inputId={`${routeFieldBase}-${place}`}
                listboxLabel={label}
                options={[
                  { value: '__tbd', label: 'TBD' },
                  { value: 'out', label: 'Out of tournament' },
                  ...routingGameOptions.filter((o) => isRenderableOption(o) && o.value !== ''),
                ]}
                value={
                  conn?.terminalType === 'out'
                    ? 'out'
                    : conn?.terminalType === 'tbd' || !conn
                      ? '__tbd'
                      : (conn.toGameId ?? '__tbd')
                }
                onChange={(v) => {
                  if (v == null || Array.isArray(v)) return;
                  if (v === '__tbd') {
                    updateDraw((d) =>
                      setPlaceConnection(d, selectedGame.id, place, { terminalType: 'tbd' }),
                    );
                    return;
                  }
                  if (v === 'out') {
                    updateDraw((d) =>
                      setPlaceConnection(d, selectedGame.id, place, { terminalType: 'out' }),
                    );
                    return;
                  }
                  updateDraw((d) =>
                    setPlaceConnection(d, selectedGame.id, place, {
                      terminalType: 'game',
                      toGameId: v,
                    }),
                  );
                }}
              />
            </FormField>
          );
        })}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
        {Array.from({ length: k }, (_, i) => i + 1).map((place) => {
          const conn = connectionForPlace(place);
          const short =
            k <= 2 ? (place === 1 ? 'Winner' : 'Loser') : `${ordinalPlaceLabel(place)} place`;
          return (
            <p key={`sum-${place}`}>
              {short}: {connectionSummary(conn, draw.games)}
            </p>
          );
        })}
      </div>
    </div>
  );
}
