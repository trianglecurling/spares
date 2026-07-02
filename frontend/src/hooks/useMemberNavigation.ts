import { useEffect, useMemo, useState } from 'react';
import { get } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useLeagueOptions } from '../contexts/LeagueOptionsContext';
import { getAdminLinks } from '../utils/memberNavigation';

interface NavLeague {
  id: number;
  name: string;
  sessionId: number | null;
}

export function useMemberNavigation() {
  const { member } = useAuth();
  const { leagues: sessionLeagues, registrationWindowSessionId } = useLeagueOptions({ autoLoad: true });
  const leagues = sessionLeagues as NavLeague[];
  const [myRosterLeagueIds, setMyRosterLeagueIds] = useState<number[]>([]);

  useEffect(() => {
    let canceled = false;
    const memberId = member?.id ?? null;
    if (memberId == null) {
      setMyRosterLeagueIds([]);
      return;
    }

    get('/members/{memberId}/leagues', { relevantSession: 'true' }, { memberId: String(memberId) })
      .then((myLeaguesRows) => {
        if (canceled) return;
        const rows = Array.isArray(myLeaguesRows) ? myLeaguesRows : [];
        setMyRosterLeagueIds([...new Set(rows.map((r) => r.leagueId))]);
      })
      .catch(() => {
        if (!canceled) {
          setMyRosterLeagueIds([]);
        }
      });

    return () => {
      canceled = true;
    };
  }, [member?.id]);

  const navMyLeaguesInCurrentSession = useMemo(() => {
    if (registrationWindowSessionId == null) return [];
    const onRoster = new Set(myRosterLeagueIds);
    return leagues.filter(
      (league) => league.sessionId === registrationWindowSessionId && onRoster.has(league.id),
    );
  }, [leagues, registrationWindowSessionId, myRosterLeagueIds]);

  const adminLinks = getAdminLinks(member);
  const isSocialMember = Boolean(member?.socialMember);

  return {
    member,
    isSocialMember,
    adminLinks,
    hasAdminLinks: adminLinks.length > 0,
    navMyLeaguesInCurrentSession,
    isNavigationReady: Boolean(member),
  };
}
