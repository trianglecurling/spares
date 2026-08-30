import { useEffect, useMemo, useState } from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { format } from 'date-fns';
import api from '../utils/api';
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
import { useClubTimeZone } from '../contexts/ClubTimeZoneContext';
import { invalidateCalendarEventsCache } from '../utils/calendarEventsCache';
import { parseClubDateParam } from '../utils/clubTime';

type LocationState = { calendarEvent?: CalendarEvent; copyFromEvent?: CalendarEvent } | null;

export default function CalendarEventFormPage() {
  const { member } = useAuth();
  const timeZone = useClubTimeZone();
  const canEditCalendar =
    member?.isCalendarAdmin ?? member?.isAdmin ?? member?.isServerAdmin ?? false;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const params = useParams();
  const splat = params['*'];
  const eventId = splat ? decodeURIComponent(splat) : null;
  const copyId = searchParams.get('copy');
  const sourceId = eventId ?? copyId;
  const isCopy = Boolean(copyId) && !eventId;

  const initialDate = useMemo(
    () => parseClubDateParam(searchParams.get('date'), timeZone),
    [searchParams, timeZone]
  );

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
    if (!sourceId) {
      setEvent(null);
      setLoadError(null);
      return;
    }

    const fromState = location.state as LocationState;
    const stateEvent = eventId
      ? fromState?.calendarEvent
      : fromState?.copyFromEvent ?? fromState?.calendarEvent;
    let canceled = false;
    setEvent(undefined);
    setLoadError(null);

    (async () => {
      type EventPayload = Parameters<typeof apiEventToCalendar>[0];
      try {
        const { data } = await api.get<EventPayload>(
          `/calendar/events/${encodeURIComponent(sourceId)}`
        );
        if (canceled) return;
        setEvent(apiEventToCalendar(data, timeZone));
      } catch {
        if (canceled) return;
        if (stateEvent && stateEvent.id === sourceId) {
          setEvent(stateEvent);
          return;
        }
        setLoadError(
          isCopy
            ? 'That event could not be copied. Open it from the calendar and try again.'
            : 'That event could not be found. Open it from the calendar and try again.'
        );
        setEvent(null);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [sourceId, eventId, isCopy, location.state, timeZone]);

  const goBackToCalendar = (focusDate?: Date) => {
    const date = focusDate ?? initialDate;
    navigate(`/calendar?date=${format(date, 'yyyy-MM-dd')}&view=month`);
  };

  const handleSaved = () => {
    invalidateCalendarEventsCache();
    goBackToCalendar(event?.start ?? initialDate);
  };

  if (!canEditCalendar) {
    return <Navigate to="/calendar" replace />;
  }

  const title = eventId ? 'Edit event' : 'New event';
  const subtitle = eventId
    ? 'Update this calendar event.'
    : isCopy
      ? 'Create a new calendar event from this one. Recurrence is not copied.'
      : 'Add a new event to the club calendar.';

  if (sourceId && loadError) {
    return (
      <>
        <div className="px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0 flex flex-col">
          <AppPage narrow>
            <AppPageHeader title={title} description={subtitle} />
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{loadError}</p>
            <BackButton label="Calendar" onClick={() => goBackToCalendar()} />
          </AppPage>
        </div>
      </>
    );
  }

  if (sourceId && event === undefined) {
    return (
      <>
        <div className="px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0 flex flex-col">
          <AppPage narrow>
            <p className="text-sm text-gray-600 dark:text-gray-400">Loading event…</p>
          </AppPage>
        </div>
      </>
    );
  }

  if (sourceId && event && isReadOnlyCalendarEvent(event)) {
    return (
      <>
        <div className="px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0 flex flex-col">
          <AppPage narrow>
            <AppPageHeader title={isCopy ? 'Cannot copy this event' : 'Cannot edit this event'} />
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              League games are managed elsewhere. Member ice bookings can be edited or canceled from
              the calendar event details.
            </p>
            <BackButton label="Calendar" onClick={() => goBackToCalendar(event.start)} />
          </AppPage>
        </div>
      </>
    );
  }

  return (
    <>
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
              key={sourceId ?? 'new'}
              event={eventId ? event! : null}
              copyFrom={isCopy ? event : null}
              sheets={sheets}
              eventTypes={DEFAULT_EVENT_TYPES}
              initialDate={initialDate}
              onSaved={handleSaved}
              onCancel={eventId ? undefined : () => goBackToCalendar(event?.start ?? initialDate)}
            />
          </div>
        </AppPage>
      </div>
    </>
  );
}
