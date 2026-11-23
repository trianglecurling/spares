import { useEffect, useState } from 'react';
import { get } from '../api/client';
import InlineStateMessage from '../components/InlineStateMessage';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import StoneActivityList from '../components/stones/StoneActivityList';
import StoneIceMap from '../components/stones/StoneIceMap';
import { getApiErrorMessage } from '../utils/api';
import {
  formatStoneDate,
  publicStoneHref,
  type StoneActivityResponse,
  type StoneSummary,
} from '../utils/curlingStones';

const SEO = {
  title: 'Curling stones | Triangle Curling Club',
  description: 'Where each of the club’s curling stones is in play, with position and maintenance history.',
  canonicalPath: '/stones',
};

function RecentChanges() {
  const [activity, setActivity] = useState<StoneActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    get('/public/stones/activity')
      .then((response) => {
        if (!canceled) setActivity(response);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(getApiErrorMessage(err, 'Recent changes are not available right now.'));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <section className="space-y-3" aria-labelledby="stone-recent-changes-heading">
      <div className="space-y-1">
        <h2 id="stone-recent-changes-heading" className="text-2xl font-semibold tracking-tight text-gray-900">
          Changes in the last 12 months
        </h2>
        <p className="text-sm text-gray-600">
          Rotations, swaps, and other moves, plus texturing, band narrowing, and imprinting
          {activity ? ` since ${formatStoneDate(activity.since)}` : ''}.
        </p>
      </div>
      {loading ? (
        <InlineStateMessage title="Loading recent changes" />
      ) : error || !activity ? (
        <InlineStateMessage title="Unable to load recent changes" description={error} tone="warning" />
      ) : activity.entries.length === 0 ? (
        <InlineStateMessage
          title="No changes in the last 12 months"
          description="Moves and maintenance will appear here as they are recorded."
        />
      ) : (
        <StoneActivityList entries={activity.entries} />
      )}
    </section>
  );
}

export default function PublicStonesPage() {
  const [stones, setStones] = useState<StoneSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    get('/public/stones')
      .then((response) => {
        if (!canceled) setStones(response.stones);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(getApiErrorMessage(err, 'Stone information is not available right now.'));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <PublicLayout>
      <SeoMeta {...SEO} />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content space-y-6">
            <div className="public-page-title-rule">
              <h1 className="public-heading text-balance">Curling stones</h1>
            </div>
            <p className="max-w-3xl text-gray-700">
              Every stone on each sheet is shown in handle order, red on the left and yellow on the right. The small
              letter on each stone is the running surface in play. Select a stone to see where it has been and how it
              has been maintained.
            </p>

            {loading ? (
              <PublicStateCard title="Loading stones" description="Gathering the current stone layout." />
            ) : error ? (
              <PublicStateCard title="Unable to load stones" description={error} tone="warning" />
            ) : stones.length === 0 ? (
              <PublicStateCard title="No stones listed yet" description="Check back soon." />
            ) : (
              <>
                <StoneIceMap stones={stones} tone="public" getStoneHref={(stone) => publicStoneHref(stone.id)} />
                <RecentChanges />
              </>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
