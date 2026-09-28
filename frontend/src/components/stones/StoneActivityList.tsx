import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  MAINTENANCE_ACTIVITY_LABELS,
  formatStoneDate,
  maintenanceSummary,
  publicStoneHref,
  stonePositionLabel,
  type StoneActivityEntry,
} from '../../utils/curlingStones';

type ActivityStone = StoneActivityEntry['stones'][number];

/** Larger batches (rotations, bulk texturing) are listed behind a disclosure to keep the feed scannable. */
const INLINE_STONE_LIMIT = 6;

function StoneLink({ stone }: { stone: ActivityStone }) {
  return (
    <Link to={publicStoneHref(stone.id)} className="font-medium text-primary-teal-link hover:underline">
      Stone {stone.wcfRegistrationNumber}
    </Link>
  );
}

function positionChange(stone: ActivityStone): string {
  return stone.from
    ? `${stonePositionLabel(stone.from)} to ${stonePositionLabel(stone.to)}`
    : stonePositionLabel(stone.to);
}

function StoneLinkList({ stones }: { stones: ActivityStone[] }) {
  return (
    <>
      {stones.map((stone, index) => (
        <span key={stone.id}>
          {index > 0 ? ', ' : null}
          <StoneLink stone={stone} />
        </span>
      ))}
    </>
  );
}

function StoneDisclosure({ stones, detail }: { stones: ActivityStone[]; detail: (stone: ActivityStone) => string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer rounded font-medium text-primary-teal-link hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40">
        Show all {stones.length} stones
      </summary>
      <ul className="mt-2 grid gap-x-6 gap-y-1 text-gray-700 sm:grid-cols-2">
        {stones.map((stone) => (
          <li key={stone.id}>
            <StoneLink stone={stone} />: {detail(stone)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function sideSummary(stones: ActivityStone[]): string {
  const sides = new Set(stones.map((stone) => stone.side));
  return sides.size === 1 ? `side ${stones[0]?.side}` : 'each stone’s side in play';
}

function describeEntry(entry: StoneActivityEntry): { title: string; body: ReactNode } {
  const { stones } = entry;
  const [first, second] = stones;
  const count = stones.length;

  switch (entry.kind) {
    case 'rotated':
      return {
        title: 'Sheets rotated',
        body: (
          <>
            <p>
              {count} {count === 1 ? 'stone' : 'stones'} moved to the next sheet: A to B, B to C, C to D, and D to A.
              Spares stayed in place.
            </p>
            <StoneDisclosure stones={stones} detail={positionChange} />
          </>
        ),
      };
    case 'swapped':
      return {
        title: 'Stones swapped',
        body:
          first && second ? (
            <p>
              <StoneLink stone={first} /> moved to {stonePositionLabel(first.to)}, and <StoneLink stone={second} />{' '}
              moved to {stonePositionLabel(second.to)}.
            </p>
          ) : first ? (
            <p>
              <StoneLink stone={first} /> moved to {stonePositionLabel(first.to)} in a swap.
            </p>
          ) : null,
      };
    case 'moved':
      return {
        title: 'Stone moved',
        body: first ? (
          <p>
            <StoneLink stone={first} /> moved {first.from ? `from ${stonePositionLabel(first.from)} ` : ''}to{' '}
            {stonePositionLabel(first.to)}.
          </p>
        ) : null,
      };
    case 'flipped':
      return {
        title: 'Stone flipped',
        body: first ? (
          <p>
            <StoneLink stone={first} /> now runs on side {first.side}.
          </p>
        ) : null,
      };
    case 'added':
      return {
        title: count === 1 ? 'Stone added' : `${count} stones added`,
        body:
          count > INLINE_STONE_LIMIT ? (
            <StoneDisclosure stones={stones} detail={(stone) => stonePositionLabel(stone.to)} />
          ) : (
            <ul className="space-y-0.5">
              {stones.map((stone) => (
                <li key={stone.id}>
                  <StoneLink stone={stone} /> at {stonePositionLabel(stone.to)}
                </li>
              ))}
            </ul>
          ),
      };
    case 'maintenance': {
      const activityType = entry.activityType ?? 'texturing';
      const summary = `${maintenanceSummary({ ...entry, activityType })} on ${sideSummary(stones)}.`;
      return {
        title: MAINTENANCE_ACTIVITY_LABELS[activityType],
        body: (
          <>
            <p>{summary}</p>
            {count > INLINE_STONE_LIMIT ? (
              <StoneDisclosure stones={stones} detail={(stone) => `side ${stone.side}`} />
            ) : (
              <p>
                <StoneLinkList stones={stones} />
              </p>
            )}
          </>
        ),
      };
    }
  }
}

export default function StoneActivityList({ entries }: { entries: StoneActivityEntry[] }) {
  return (
    <ol className="public-card divide-y divide-gray-200">
      {entries.map((entry) => {
        const { title, body } = describeEntry(entry);
        return (
          <li key={entry.id} className="grid gap-1 p-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4 sm:p-5">
            <time dateTime={entry.date} className="text-sm font-medium text-gray-600">
              {formatStoneDate(entry.date)}
            </time>
            <div className="space-y-1.5 text-sm text-gray-700">
              <p className="text-base font-semibold text-gray-900">{title}</p>
              {body}
              {entry.notes ? <p className="text-gray-600">Note: {entry.notes}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
