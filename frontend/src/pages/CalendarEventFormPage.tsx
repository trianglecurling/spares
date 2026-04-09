import { useEffect, useMemo, useState } from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { addYears, format, parseISO, subYears } from 'date-fns';
import api from '../utils/api';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import BackButton from '../components/BackButton';
import CalendarEventForm from '../components/CalendarEventForm';
import {
  apiEventToCalendar,
  DEFAULT_EVENT_TYPES,
  type CalendarEvent,
  isReadOnlyCalendarEvent,
} from './Calendar';
import { useAuth } from '../contexts/AuthContext';

type LocationState = { calendarEvent?: CalendarEvent } | null;

export default function CalendarEventFormPage() {
  const { member } = useAuth();
  const canEditCalendar =
    member?.isCalendarAdmin ?? member?.isAdmin ?? member?.isServerAdmin ?? false;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const params = useParams();
  const splat = params['*'];
  const eventId = splat ? decodeURIComponent(splat) : null;

  const initialDate = useMemo(() => {
    const d = searchParams.get('date');
    if (d) {
      try {
        return parseISO(d);
      } catch {
        /* fall through */
      }
    }
    return new Date();
  }, [searchParams]);

  const [sheets, setSheets] = useState<Array<{ id: number; name: string }>>([]);
  const [event, setEvent] = useState<CalendarEvent | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Array<{ id: number; name: string; isActive?: boolean }>>('/sheets')
      .then((res) => {
        const active = (res.data ?? []).filter((s) => s.isActive !== false);
        setSheets(active.map((s) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!eventId) {
      setEvent(null);
      setLoadError(null);
      return;
    }

    const fromState = (location.state as LocationState)?.calendarEvent;
    if (fromState && fromState.id === eventId) {
      setEvent(fromState);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setEvent(undefined);
    setLoadError(null);

    (async () => {
      const start = subYears(new Date(), 5);
      const end = addYears(new Date(), 5);
      type EventPayload = Parameters<typeof apiEventToCalendar>[0];
      try {
        const { data } = await api.get<EventPayload[]>(
          `/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`
        );
        const found = (data ?? []).map(apiEventToCalendar).find((e) => e.id === eventId);
        if (cancelled) return;
        if (!found) {
          setLoadError(
            'That event could not be found. It may be outside the search window—open it from the calendar and try again.'
          );
          setEvent(null);
          return;
        }
        setEvent(found);
      } catch {
        if (!cancelled) {
          setLoadError('Failed to load the event.');
          setEvent(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, location.state]);

  const goBackToCalendar = (focusDate?: Date) => {
    const date = focusDate ?? initialDate;
    navigate(`/calendar?date=${format(date, 'yyyy-MM-dd')}&view=month`);
  };

  const handleSaved = () => {
    goBackToCalendar(event?.start ?? initialDate);
  };

  if (!canEditCalendar) {
    return <Navigate to="/calendar" replace />;
  }

  const title = eventId ? 'Edit event' : 'New event';
  const subtitle = eventId
    ? 'Update this calendar event.'
    : 'Add a new event to the club calendar.';

  if (eventId && loadError) {
    return (
      <Layout fullWidth>
        <div className="px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0 flex flex-col">
          <AppPage narrow>
            <AppPageHeader title={title} description={subtitle} />
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{loadError}</p>
            <BackButton label="Calendar" onClick={() => goBackToCalendar()} />
          </AppPage>
        </div>
      </Layout>
    );
  }

  if (eventId && event === undefined) {
    return (
      <Layout fullWidth>
        <div className="px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0 flex flex-col">
          <AppPage narrow>
            <p className="text-sm text-gray-600 dark:text-gray-400">Loading event…</p>
          </AppPage>
        </div>
      </Layout>
    );
  }

  if (eventId && event && isReadOnlyCalendarEvent(event)) {
    return (
      <Layout fullWidth>
        <div className="px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0 flex flex-col">
          <AppPage narrow>
            <AppPageHeader title="Cannot edit this event" />
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              League games and member ice bookings are managed elsewhere.
            </p>
            <BackButton label="Calendar" onClick={() => goBackToCalendar(event.start)} />
          </AppPage>
        </div>
      </Layout>
    );
  }

  return (
    <Layout fullWidth>
      <div className="px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0 flex flex-col">
        <AppPage narrow>
          <AppPageHeader
            title={title}
            description={subtitle}
            actions={
              <BackButton
                label="Calendar"
                onClick={() => goBackToCalendar(event?.start ?? initialDate)}
              />
            }
          />
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
            <CalendarEventForm
              event={eventId ? event! : null}
              sheets={sheets}
              eventTypes={DEFAULT_EVENT_TYPES}
              initialDate={initialDate}
              onCancel={() => goBackToCalendar(event?.start ?? initialDate)}
              onSaved={handleSaved}
            />
          </div>
        </AppPage>
      </div>
    </Layout>
  );
}
