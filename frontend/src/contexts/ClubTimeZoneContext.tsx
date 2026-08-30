import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_CLUB_TIME_ZONE,
  getClubTimeZone,
  setClubTimeZone,
} from '../utils/clubTime';

type ClubTimeZoneContextValue = {
  timeZone: string;
};

const ClubTimeZoneContext = createContext<ClubTimeZoneContextValue>({
  timeZone: DEFAULT_CLUB_TIME_ZONE,
});

export function ClubTimeZoneProvider({ children }: { children: ReactNode }) {
  const [timeZone, setTimeZone] = useState(getClubTimeZone);

  useEffect(() => {
    let canceled = false;
    fetch('/api/public-config', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { timeZone?: string } | null) => {
        if (canceled || typeof data?.timeZone !== 'string' || !data.timeZone.trim()) return;
        setClubTimeZone(data.timeZone);
        setTimeZone(getClubTimeZone());
      })
      .catch(() => {
        // Keep the default club zone if public-config is unavailable.
      });
    return () => {
      canceled = true;
    };
  }, []);

  const value = useMemo(() => ({ timeZone }), [timeZone]);
  return <ClubTimeZoneContext.Provider value={value}>{children}</ClubTimeZoneContext.Provider>;
}

export function useClubTimeZone(): string {
  return useContext(ClubTimeZoneContext).timeZone;
}
