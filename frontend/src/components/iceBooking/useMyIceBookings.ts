import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { formatApiError } from '../../utils/api';
import type { MyIceBooking } from './iceBookingShared';

/** The signed-in member's ice bookings that have not ended yet, soonest first. */
export function useMyIceBookings() {
  const [bookings, setBookings] = useState<MyIceBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<MyIceBooking[]>('/ice-bookings');
      setBookings(data ?? []);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Could not load your ice bookings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return bookings
      .filter((booking) => new Date(booking.end).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [bookings]);

  return { upcoming, loading, error, reload };
}
