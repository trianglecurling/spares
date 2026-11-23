import { useId } from 'react';
import { Link } from 'react-router-dom';
import {
  ROCK_NUMBERS,
  STONE_COLOR_HEX,
  STONE_COLOR_LABELS,
  STONE_COLORS,
  STONE_SHEETS,
  stonePositionKey,
  stonePositionLabel,
  stonesByPosition,
  type StoneColor,
  type StonePosition,
  type StoneSheet,
  type StoneSummary,
} from '../../utils/curlingStones';

type StoneIceMapTone = 'app' | 'public';

type StoneIceMapProps = {
  stones: StoneSummary[];
  getStoneHref: (stone: StoneSummary) => string;
  /** When provided, empty positions become buttons (e.g. to assign a stone there). */
  onEmptyPositionClick?: (position: StonePosition) => void;
  tone?: StoneIceMapTone;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const cardClasses: Record<StoneIceMapTone, string> = {
  app: 'app-card p-3 sm:p-4',
  public: 'public-card p-3 sm:p-4',
};

const slotInteractiveClasses =
  'group flex w-full min-w-0 items-center gap-2 rounded-full p-0.5 pr-2 text-left transition-colors hover:bg-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/60 dark:hover:bg-slate-900/40';

export function StoneGlyph({
  color,
  label,
  side,
}: {
  color: StoneColor | null;
  label: string;
  side?: string | null;
}) {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 via-gray-400 to-gray-500 shadow-sm ring-1 ring-black/10"
    >
      <span
        className="absolute inset-[6px] rounded-full ring-1 ring-black/10"
        style={{ backgroundColor: color ? STONE_COLOR_HEX[color] : '#9CA3AF' }}
      />
      <span className={joinClasses('relative text-xs font-bold', color === 'yellow' ? 'text-gray-900' : 'text-white')}>
        {label}
      </span>
      {side ? (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-semibold leading-none text-gray-700 ring-1 ring-gray-300">
          {side}
        </span>
      ) : null}
    </span>
  );
}

function EmptyGlyph({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-xs font-semibold text-gray-400 dark:border-gray-500 dark:text-gray-400"
    >
      {label}
    </span>
  );
}

function HouseGraphic() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className="relative mx-auto mb-3 h-16 w-16 sm:h-20 sm:w-20">
      <circle cx="50" cy="50" r="48" fill="#2563EB" fillOpacity="0.75" />
      <circle cx="50" cy="50" r="32" fill="#FFFFFF" />
      <circle cx="50" cy="50" r="16" fill="#DC2626" fillOpacity="0.8" />
      <circle cx="50" cy="50" r="5" fill="#FFFFFF" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="#1F2937" strokeOpacity="0.35" strokeWidth="1" />
    </svg>
  );
}

function stoneAriaLabel(stone: StoneSummary): string {
  const position = stonePositionLabel(stone.current);
  const side = stone.current ? `, running on side ${stone.current.side}` : '';
  return `${position}: stone ${stone.wcfRegistrationNumber}${side}`;
}

function StoneSlot({
  position,
  glyphLabel,
  stone,
  getStoneHref,
  onEmptyPositionClick,
}: {
  position: StonePosition;
  glyphLabel: string;
  stone: StoneSummary | undefined;
  getStoneHref: (stone: StoneSummary) => string;
  onEmptyPositionClick?: (position: StonePosition) => void;
}) {
  if (stone) {
    return (
      <Link to={getStoneHref(stone)} aria-label={stoneAriaLabel(stone)} className={slotInteractiveClasses}>
        <StoneGlyph color={position.color} label={glyphLabel} side={stone.current?.side} />
        <span className="min-w-0 truncate text-xs font-medium text-gray-800 group-hover:underline dark:text-gray-100">
          {stone.wcfRegistrationNumber}
        </span>
      </Link>
    );
  }

  const label = stonePositionLabel(position);
  if (onEmptyPositionClick) {
    return (
      <button
        type="button"
        onClick={() => onEmptyPositionClick(position)}
        aria-label={`${label} is empty. Assign a stone.`}
        className={slotInteractiveClasses}
      >
        <EmptyGlyph label={glyphLabel} />
        <span className="text-xs text-gray-500 group-hover:underline dark:text-gray-400">Assign</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-0.5">
      <EmptyGlyph label={glyphLabel} />
      <span className="text-xs text-gray-400">
        Empty<span className="sr-only"> ({label})</span>
      </span>
    </div>
  );
}

function SheetCard({
  sheet,
  occupants,
  tone,
  getStoneHref,
  onEmptyPositionClick,
}: {
  sheet: StoneSheet;
  occupants: Map<string, StoneSummary>;
  tone: StoneIceMapTone;
  getStoneHref: (stone: StoneSummary) => string;
  onEmptyPositionClick?: (position: StonePosition) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cardClasses[tone]}>
      <h3
        id={headingId}
        className="mb-3 text-center text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-200"
      >
        Sheet {sheet}
      </h3>
      <div className="relative overflow-hidden rounded-lg border border-sky-100 bg-gradient-to-b from-sky-50 to-white px-2 pb-3 pt-3 dark:border-slate-600 dark:from-slate-700/70 dark:to-slate-800">
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-sky-200 dark:bg-slate-600" />
        <HouseGraphic />
        <div className="relative grid grid-cols-2 gap-x-2">
          {STONE_COLORS.map((color) => (
            <ol
              key={color}
              aria-label={`Sheet ${sheet} ${STONE_COLOR_LABELS[color].toLowerCase()} stones in handle order`}
              className="min-w-0 space-y-1"
            >
              {ROCK_NUMBERS.map((rockNumber) => {
                const position: StonePosition = { sheet, color, rockNumber };
                return (
                  <li key={rockNumber} className="min-w-0">
                    <StoneSlot
                      position={position}
                      glyphLabel={String(rockNumber)}
                      stone={occupants.get(stonePositionKey(position) ?? '')}
                      getStoneHref={getStoneHref}
                      onEmptyPositionClick={onEmptyPositionClick}
                    />
                  </li>
                );
              })}
            </ol>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function StoneIceMap({
  stones,
  getStoneHref,
  onEmptyPositionClick,
  tone = 'app',
}: StoneIceMapProps) {
  const occupants = stonesByPosition(stones);
  const unassigned = stones.filter((stone) => !stone.current || stone.current.color == null);
  const sparesHeadingId = useId();
  const unassignedHeadingId = useId();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STONE_SHEETS.map((sheet) => (
          <SheetCard
            key={sheet}
            sheet={sheet}
            occupants={occupants}
            tone={tone}
            getStoneHref={getStoneHref}
            onEmptyPositionClick={onEmptyPositionClick}
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section aria-labelledby={sparesHeadingId} className={cardClasses[tone]}>
          <h3
            id={sparesHeadingId}
            className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-200"
          >
            Spares
          </h3>
          <ul className="grid grid-cols-2 gap-x-2">
            {STONE_COLORS.map((color) => {
              const position: StonePosition = { sheet: null, color, rockNumber: null };
              return (
                <li key={color} className="min-w-0 space-y-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{STONE_COLOR_LABELS[color]}</p>
                  <StoneSlot
                    position={position}
                    glyphLabel="S"
                    stone={occupants.get(stonePositionKey(position) ?? '')}
                    getStoneHref={getStoneHref}
                    onEmptyPositionClick={onEmptyPositionClick}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        {unassigned.length > 0 ? (
          <section
            aria-labelledby={unassignedHeadingId}
            className={joinClasses(cardClasses[tone], 'sm:col-span-1 xl:col-span-3')}
          >
            <h3
              id={unassignedHeadingId}
              className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-200"
            >
              Unassigned
            </h3>
            <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
              {unassigned.map((stone) => (
                <li key={stone.id} className="min-w-0">
                  <StoneSlot
                    position={{ sheet: null, color: null, rockNumber: null }}
                    glyphLabel="–"
                    stone={stone}
                    getStoneHref={getStoneHref}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
