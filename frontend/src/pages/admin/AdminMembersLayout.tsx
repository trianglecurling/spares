import { useMemo } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import PageTabs from '../../components/PageTabs';
import { useAuth } from '../../contexts/AuthContext';
import {
  memberCanAccessMembersArea,
  memberCanManageCredentials,
  memberCanManageMembersAdmin,
} from '../../utils/credentialAccess';

type MembersAreaTab = 'members' | 'credentials' | 'org-rosters';

function membersAreaTab(pathname: string): MembersAreaTab {
  if (pathname.includes('/credentials')) return 'credentials';
  if (pathname.includes('/org-rosters')) return 'org-rosters';
  return 'members';
}

export default function AdminMembersLayout() {
  const location = useLocation();
  const { member } = useAuth();
  const canManageMembers = memberCanManageMembersAdmin(member);
  const canManageCredentials = memberCanManageCredentials(member);
  const canAccessArea = memberCanAccessMembersArea(member);
  const activeTab = membersAreaTab(location.pathname);

  const tabs = useMemo(
    () => [
      ...(canManageMembers
        ? [
            {
              key: 'members',
              label: 'Members',
              to: '/admin/members',
              isActive: activeTab === 'members',
            },
            {
              key: 'org-rosters',
              label: 'Org rosters',
              to: '/admin/members/org-rosters',
              isActive: activeTab === 'org-rosters',
            },
          ]
        : []),
      ...(canManageCredentials
        ? [
            {
              key: 'credentials',
              label: 'Credentials',
              to: '/admin/members/credentials',
              isActive: activeTab === 'credentials',
            },
          ]
        : []),
    ],
    [activeTab, canManageCredentials, canManageMembers]
  );

  if (!canAccessArea) {
    return <Navigate to="/dashboard" replace />;
  }

  if ((activeTab === 'members' || activeTab === 'org-rosters') && !canManageMembers) {
    return <Navigate to="/admin/members/credentials" replace />;
  }

  if (activeTab === 'credentials' && !canManageCredentials) {
    return <Navigate to="/admin/members" replace />;
  }

  const title =
    activeTab === 'credentials'
      ? 'Manage credentials'
      : activeTab === 'org-rosters'
        ? 'Org rosters'
        : 'Manage members';
  const description =
    activeTab === 'credentials'
      ? 'Credentials held by members, who manages them, and who holds them.'
      : activeTab === 'org-rosters'
        ? 'Copy current-member rows into USA Curling and USWCA templates, and ask members to confirm parent org options.'
        : undefined;

  return (
    <AppPage>
      <AppPageHeader title={title} description={description} />
      {tabs.length > 1 ? <PageTabs items={tabs} /> : null}
      <Outlet />
    </AppPage>
  );
}
