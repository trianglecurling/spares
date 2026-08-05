import { useEffect, useMemo, useState } from 'react';
import { get } from '../api/client';
import type { NavMenuItemNode } from '../components/DesktopFlyoutNav';
import { useAuth } from '../contexts/AuthContext';
import { useLeagueOptions } from '../contexts/LeagueOptionsContext';
import {
  fetchMemberMenuTree,
  getCachedMemberMenuTree,
  MEMBER_MENU_INVALIDATED_EVENT,
} from '../utils/memberMenuClient';
import {
  buildMemberNavMenuItemsFallback,
  resolveMemberNavMenuItems,
} from '../utils/memberNavMenuItems';
import { getAdminLinks } from '../utils/memberNavigation';
import { memberHasScope } from '../utils/permissions';

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
  const [menuTree, setMenuTree] = useState<NavMenuItemNode[] | null>(() =>
    member ? getCachedMemberMenuTree() : null,
  );
  const [menuReloadToken, setMenuReloadToken] = useState(0);

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

  useEffect(() => {
    const onInvalidated = () => setMenuReloadToken((token) => token + 1);
    window.addEventListener(MEMBER_MENU_INVALIDATED_EVENT, onInvalidated);
    return () => window.removeEventListener(MEMBER_MENU_INVALIDATED_EVENT, onInvalidated);
  }, []);

  useEffect(() => {
    if (!member) {
      setMenuTree(null);
      return;
    }

    const cached = getCachedMemberMenuTree();
    if (cached) {
      setMenuTree(cached);
    }

    let canceled = false;
    // Cache is cleared on admin edits; otherwise this returns the module cache instantly
    // and Layout + MemberNavigationPanel share one in-flight request.
    void fetchMemberMenuTree()
      .then((tree) => {
        if (!canceled) setMenuTree(tree);
      })
      .catch(() => {
        if (!canceled && getCachedMemberMenuTree() == null) {
          setMenuTree([]);
        }
      });

    return () => {
      canceled = true;
    };
  }, [member, menuReloadToken]);

  const navMyLeaguesInCurrentSession = useMemo(() => {
    if (registrationWindowSessionId == null) return [];
    const onRoster = new Set(myRosterLeagueIds);
    return leagues.filter(
      (league) => league.sessionId === registrationWindowSessionId && onRoster.has(league.id),
    );
  }, [leagues, registrationWindowSessionId, myRosterLeagueIds]);

  const adminLinks = getAdminLinks(member);
  const isSocialMember = Boolean(member?.socialMember);
  const isActiveMember = memberHasScope(member, 'member.active');
  const hasAdminLinks = adminLinks.length > 0;

  const memberNavItems = useMemo(() => {
    if (menuTree == null) return [];
    const context = {
      navMyLeaguesInCurrentSession,
      isSocialMember,
      isActiveMember,
      adminLinks,
      hasAdminLinks,
    };
    if (menuTree.length === 0) {
      return buildMemberNavMenuItemsFallback(context);
    }
    return resolveMemberNavMenuItems({ menuTree, ...context });
  }, [
    menuTree,
    navMyLeaguesInCurrentSession,
    isSocialMember,
    isActiveMember,
    adminLinks,
    hasAdminLinks,
  ]);

  return {
    member,
    isSocialMember,
    isActiveMember,
    adminLinks,
    hasAdminLinks,
    navMyLeaguesInCurrentSession,
    memberNavItems,
    isNavigationReady: Boolean(member) && menuTree !== null,
  };
}
