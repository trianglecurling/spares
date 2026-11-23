import axios from 'axios';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get } from '../api/client';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import StoneDetailsList from '../components/stones/StoneDetailsList';
import { StoneMaintenanceTable, StonePlacementTable } from '../components/stones/StoneHistoryTables';
import { getApiErrorMessage } from '../utils/api';
import { publicStoneHref, stonePositionLabel, stoneTitle, type StoneDetailResponse } from '../utils/curlingStones';

function AllStonesLink() {
  return (
    <Link to="/stones" className="text-sm font-medium text-primary-teal-link hover:underline">
      ← All stones
    </Link>
  );
}

export default function PublicStoneDetailPage() {
  const { stoneId = '' } = useParams();
  const [detail, setDetail] = useState<StoneDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    get('/public/stones/{id}', undefined, { id: stoneId })
      .then((response) => {
        if (!canceled) setDetail(response);
      })
      .catch((err: unknown) => {
        if (canceled) return;
        const notFound = axios.isAxiosError(err) && (err.response?.status === 404 || err.response?.status === 400);
        setError({ notFound, message: getApiErrorMessage(err, 'Stone information is not available right now.') });
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [stoneId]);

  const title = detail ? stoneTitle(detail.stone) : 'Curling stone';

  return (
    <PublicLayout>
      <SeoMeta
        title={`${title} | Triangle Curling Club`}
        description={
          detail
            ? `${stonePositionLabel(detail.stone.current)}. Position and maintenance history for ${title.toLowerCase()}.`
            : 'Position and maintenance history for a club curling stone.'
        }
        canonicalPath={publicStoneHref(Number(stoneId) || 0)}
      />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content space-y-6">
            <AllStonesLink />
            {loading ? (
              <PublicStateCard title="Loading stone" description="Gathering this stone’s history." />
            ) : error || !detail ? (
              <PublicStateCard
                title={error?.notFound ? 'Stone not found' : 'Unable to load stone'}
                description={error?.notFound ? 'This stone may no longer be in the club’s set.' : error?.message}
                tone="warning"
                action={<AllStonesLink />}
              />
            ) : (
              <>
                <div className="public-page-title-rule">
                  <h1 className="public-heading text-balance">{title}</h1>
                </div>
                <div className="public-card p-5 sm:p-6">
                  <StoneDetailsList stone={detail.stone} />
                </div>
                <section className="space-y-3">
                  <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Maintenance</h2>
                  <StoneMaintenanceTable records={detail.maintenance} />
                </section>
                <section className="space-y-3">
                  <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Position history</h2>
                  <StonePlacementTable placements={detail.placements} getStoneHref={publicStoneHref} />
                </section>
              </>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
