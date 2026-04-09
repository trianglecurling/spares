import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import api from '../utils/api';

interface EventSummary {
  id: number;
  title: string;
  slug: string;
  visibility: string;
  published: number;
  capacity: number | null;
  feeMinor: number;
  memberFeeMinor?: number | null;
  currency: string;
  imageFileId: number | null;
  enableWaitlist: number;
  timespans: Array<{ start_dt: string; end_dt: string }>;
  locations: Array<{ location_type: string; sheet_id?: number }>;
  categoryIds: number[];
  registrationStart: string | null;
  registrationCutoff: string | null;
}

function formatEventDate(timespans: Array<{ start_dt: string; end_dt: string }>): string {
  if (!timespans || timespans.length === 0) return 'Date TBD';
  const first = timespans[0];
  try {
    const start = new Date(first.start_dt);
    return start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return first.start_dt;
  }
}

function formatEventTime(timespans: Array<{ start_dt: string; end_dt: string }>): string {
  if (!timespans || timespans.length === 0) return '';
  const first = timespans[0];
  try {
    const start = new Date(first.start_dt);
    const end = new Date(first.end_dt);
    return `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}

function formatFee(feeMinor: number, currency: string): string {
  if (feeMinor <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

export default function PublicEventsPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/public/events')
      .then((res) => setEvents(res.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const upcomingEvents = events.filter((e) => {
    if (!e.timespans || e.timespans.length === 0) return true;
    const latestEnd = e.timespans.reduce(
      (max, ts) => (ts.end_dt > max ? ts.end_dt : max),
      e.timespans[0].end_dt
    );
    return new Date(latestEnd) >= new Date();
  });

  return (
    <PublicLayout>
      <SeoMeta title="Events" description="Upcoming events at the club" />
      <div className="max-w-5xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Upcoming Events</h1>

        {loading && (
          <PublicStateCard
            title="Loading events..."
            description="Fetching upcoming events and bonspiels."
          />
        )}

        {!loading && upcomingEvents.length === 0 && (
          <PublicStateCard
            title="No upcoming events right now."
            description="Check back soon for upcoming bonspiels, socials, clinics, and other club events."
          />
        )}

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {upcomingEvents.map((event) => (
            <Link
              key={event.id}
              to={`/events/${event.slug}`}
              className="block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
            >
              {event.imageFileId && (
                <div className="h-44 bg-gray-100 overflow-hidden">
                  <img
                    src={`/api/public/files/${event.imageFileId}`}
                    alt={event.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
                  {event.title}
                </h2>
                <p className="text-sm text-gray-600 mb-1">
                  {formatEventDate(event.timespans)}
                </p>
                <p className="text-sm text-gray-500 mb-3">
                  {formatEventTime(event.timespans)}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-primary-teal">
                    {event.memberFeeMinor != null && event.memberFeeMinor !== event.feeMinor ? (
                      <>
                        {formatFee(event.feeMinor, event.currency)}{' '}
                        <span className="text-gray-500 font-normal">/ {formatFee(event.memberFeeMinor, event.currency)} members</span>
                      </>
                    ) : (
                      formatFee(event.feeMinor, event.currency)
                    )}
                  </span>
                  {event.capacity && (
                    <span className="text-xs text-gray-400">
                      {event.capacity} spots
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
