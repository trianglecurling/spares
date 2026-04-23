import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';
import FormField from '../components/FormField';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import {
  EVENT_CALENDAR_TYPE_OPTIONS,
  eventOverlapsRangeUtc,
  formatTwoYearSeasonLabel,
  getEarliestStartMs,
  getSeasonUtcRangeIso,
  isUpcomingEventUtc,
  parseFiscalYearStartMmdd,
} from '../utils/fiscalSeason';
import {
  formatEventScheduleBlock,
  publicCategoryBadgeClass,
  publicEventTypeBadgeClass,
  publicEventTypeLabel,
} from '../utils/publicEventCardUtils';
import api from '../utils/api';

interface PublicSiteConfigResponse {
  fiscalYearStartMmdd?: string;
}

interface SeasonsWithEventsResponse {
  seasonStartYears: number[];
}

interface EventCategoryRow {
  id: number;
  name: string;
}

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
  calendarTypeId?: string;
}

type PastSeasonValue = `s-${number}`;

function formatFee(feeMinor: number, currency: string): string {
  if (feeMinor <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

function pastSeasonToValue(y: number | null): PastSeasonValue | null {
  if (y == null) return null;
  return `s-${y}`;
}

function valueToPastSeasonStartYear(
  v: PastSeasonValue | PastSeasonValue[] | null,
): number | null {
  if (v == null) return null;
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null) return null;
  const m = /^s-(\d+)$/.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeCategoryRows(data: unknown): EventCategoryRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      if (row && typeof row === 'object' && 'id' in row && 'name' in row) {
        const id = (row as { id: unknown }).id;
        const name = (row as { name: unknown }).name;
        if (typeof id === 'number' && typeof name === 'string') {
          return { id, name };
        }
      }
      return null;
    })
    .filter((r): r is EventCategoryRow => r != null);
}

export default function PublicEventsPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fiscalYearStartMmdd, setFiscalYearStartMmdd] = useState<string>('09-01');
  const [seasonYearsWithEvents, setSeasonYearsWithEvents] = useState<number[]>([]);
  const [categoryById, setCategoryById] = useState<Map<number, string>>(new Map());
  /** `null` = all upcoming events in chronological order (any season). */
  const [pastSeasonStartYear, setPastSeasonStartYear] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const pastEventsId = useId();
  const typesId = useId();
  const fiscal = useMemo(() => parseFiscalYearStartMmdd(fiscalYearStartMmdd), [fiscalYearStartMmdd]);

  const typeOptions: ChoiceOption<string>[] = useMemo(
    () => EVENT_CALENDAR_TYPE_OPTIONS.map((o) => ({ type: 'option' as const, value: o.id, label: o.label })),
    [],
  );

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      api.get<EventSummary[]>('/public/events'),
      api.get<PublicSiteConfigResponse>('/public/site-config'),
      api.get<SeasonsWithEventsResponse>('/public/events/seasons'),
      api.get<unknown>('/public/events/categories'),
    ])
      .then((results) => {
        const [evRes, cfgRes, seasonsRes, catRes] = results;
        if (evRes.status === 'fulfilled' && evRes.value.data) {
          setEvents(evRes.value.data);
        } else {
          setEvents([]);
        }
        if (cfgRes.status === 'fulfilled' && cfgRes.value.data) {
          const m = cfgRes.value.data.fiscalYearStartMmdd;
          if (typeof m === 'string' && m.trim() !== '') {
            setFiscalYearStartMmdd(m);
          }
        }
        if (seasonsRes.status === 'fulfilled' && seasonsRes.value.data?.seasonStartYears) {
          setSeasonYearsWithEvents(seasonsRes.value.data.seasonStartYears);
        } else {
          setSeasonYearsWithEvents([]);
        }
        if (catRes.status === 'fulfilled') {
          const payload = catRes.value.data;
          const raw = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
          const rows = normalizeCategoryRows(raw);
          setCategoryById(new Map(rows.map((c) => [c.id, c.name])));
        } else {
          setCategoryById(new Map());
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const pastEventOptions: ChoiceOption<PastSeasonValue>[] = useMemo(
    () =>
      seasonYearsWithEvents.map((y) => ({
        type: 'option' as const,
        value: `s-${y}` as PastSeasonValue,
        label: formatTwoYearSeasonLabel(y),
      })),
    [seasonYearsWithEvents],
  );

  const sortedDisplayEvents = useMemo(() => {
    const asOf = Date.now();
    const typeSet = typeFilter.length > 0 ? new Set(typeFilter) : null;

    const list = events
      .filter((e) => {
        const tid = e.calendarTypeId ?? 'other';
        if (typeSet && !typeSet.has(tid)) return false;
        return true;
      })
      .filter((e) => {
        if (pastSeasonStartYear === null) {
          return isUpcomingEventUtc(e.timespans, asOf);
        }
        if (!e.timespans || e.timespans.length === 0) {
          return false;
        }
        if (isUpcomingEventUtc(e.timespans, asOf)) {
          return false;
        }
        const { startIso, endIsoExclusive } = getSeasonUtcRangeIso(pastSeasonStartYear, fiscal);
        return eventOverlapsRangeUtc(e.timespans, startIso, endIsoExclusive);
      });

    return list.sort((a, b) => getEarliestStartMs(a.timespans) - getEarliestStartMs(b.timespans));
  }, [events, pastSeasonStartYear, typeFilter, fiscal]);

  const emptyDescription =
    pastSeasonStartYear === null
      ? 'Check back soon for upcoming events, or try another event type filter.'
      : 'No past public events in this season match your filters. Try a different year or event type, or return to upcoming events.';

  const showUpcomingLink = pastSeasonStartYear !== null;
  const pastEventsValue = pastSeasonToValue(pastSeasonStartYear);

  return (
    <PublicLayout>
      <SeoMeta
        title="Events"
        description="Upcoming and past public events, bonspiels, and programs at the club"
      />
      <div className="public-container">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Events</h1>

        <div className="mb-6 flex w-full flex-row flex-wrap items-end justify-end gap-3">
          <div className="w-full min-w-0 max-w-[12rem]">
            <button
              type="button"
              onClick={() => {
                if (showUpcomingLink) setPastSeasonStartYear(null);
              }}
              tabIndex={showUpcomingLink ? 0 : -1}
              aria-hidden={!showUpcomingLink}
              className={`text-left text-sm font-medium text-primary-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 rounded ${
                showUpcomingLink
                  ? 'hover:underline'
                  : 'invisible pointer-events-none cursor-default'
              }`}
            >
              Back to upcoming events
            </button>
          </div>
          <div className="w-full max-w-[12rem]">
            <FormField label="Show past events" htmlFor={pastEventsId} className="w-full" tone="public">
              <ChoiceInput<PastSeasonValue>
                inputId={pastEventsId}
                layout="popover"
                options={pastEventOptions}
                value={pastEventsValue}
                onChange={(v) => {
                  setPastSeasonStartYear(valueToPastSeasonStartYear(v));
                }}
                placeholder={seasonYearsWithEvents.length > 0 ? 'Select a season' : 'No past seasons yet'}
                emptyText="No seasons with past events"
                listboxLabel="Show past events"
                disabled={loading || seasonYearsWithEvents.length === 0}
              />
            </FormField>
          </div>
          <div className="w-full max-w-[12rem]">
            <FormField label="Event type" htmlFor={typesId} className="w-full" tone="public">
              <ChoiceInput<string>
                inputId={typesId}
                layout="popover"
                maxSelectedItems={null}
                multiSelectionIndicatorStyle="checkboxes"
                options={typeOptions}
                value={typeFilter}
                onChange={(v) => {
                  const next = Array.isArray(v) ? v : [];
                  if (next.length === EVENT_CALENDAR_TYPE_OPTIONS.length) {
                    setTypeFilter([]);
                  } else {
                    setTypeFilter(next);
                  }
                }}
                placeholder="All event types"
                listboxLabel="Event type"
              />
            </FormField>
          </div>
        </div>

        {loading && (
          <PublicStateCard
            title="Loading events..."
            description="Fetching public events and bonspiels."
          />
        )}

        {!loading && sortedDisplayEvents.length === 0 && (
          <PublicStateCard title="No events match this view" description={emptyDescription} />
        )}

        <div className="flex w-full flex-col gap-4">
          {!loading &&
            sortedDisplayEvents.map((event) => {
              const { dateLine, timeLine } = formatEventScheduleBlock(event.timespans);
              const typeId = event.calendarTypeId ?? 'other';
              return (
                <Link
                  key={event.id}
                  to={`/events/${event.slug}`}
                  className="flex w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-stretch"
                >
                  {event.imageFileId ? (
                    <div className="h-44 shrink-0 bg-gray-100 sm:h-auto sm:w-56 sm:min-w-[14rem]">
                      <img
                        src={`/api/public/files/${event.imageFileId}`}
                        alt={event.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col p-5">
                    <h2 className="mb-2 line-clamp-2 text-lg font-semibold text-gray-900">{event.title}</h2>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-medium ${publicEventTypeBadgeClass(typeId)}`}
                      >
                        {publicEventTypeLabel(typeId)}
                      </span>
                      {(event.categoryIds ?? []).map((cid) => {
                        const name = categoryById.get(cid);
                        if (!name) return null;
                        return (
                          <span
                            key={cid}
                            className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-medium ${publicCategoryBadgeClass(cid)}`}
                          >
                            {name}
                          </span>
                        );
                      })}
                    </div>
                    <p className={`text-sm text-gray-600 ${timeLine ? 'mb-0.5' : 'mb-3'}`}>{dateLine}</p>
                    {timeLine ? <p className="mb-3 text-sm text-gray-500">{timeLine}</p> : null}
                    <div className="mt-auto flex items-center justify-between">
                      <span className="text-sm font-medium text-primary-teal">
                        {event.memberFeeMinor != null && event.memberFeeMinor !== event.feeMinor ? (
                          <>
                            {formatFee(event.feeMinor, event.currency)}{' '}
                            <span className="font-normal text-gray-500">/ {formatFee(event.memberFeeMinor, event.currency)} members</span>
                          </>
                        ) : (
                          formatFee(event.feeMinor, event.currency)
                        )}
                      </span>
                      {event.capacity ? <span className="text-xs text-gray-400">{event.capacity} spots</span> : null}
                    </div>
                  </div>
                </Link>
              );
            })}
        </div>
      </div>
    </PublicLayout>
  );
}
