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

type MembersAreaTab = 'members' | 'credentials';

export default function AdminMembersLayout() {
  const location = useLocation();
  const { member } = useAuth();
  const canManageMembers = memberCanManageMembersAdmin(member);
  const canManageCredentials = memberCanManageCredentials(member);
  const canAccessArea = memberCanAccessMembersArea(member);

  const activeTab: MembersAreaTab = location.pathname.endsWith('/credentials')
    ? 'credentials'
    : 'members';

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

  if (activeTab === 'members' && !canManageMembers) {
    return <Navigate to="/admin/members/credentials" replace />;
  }

  if (activeTab === 'credentials' && !canManageCredentials) {
    return <Navigate to="/admin/members" replace />;
  }

  return (
    <AppPage>
      <AppPageHeader
        title={activeTab === 'credentials' ? 'Manage credentials' : 'Manage members'}
        description={
          activeTab === 'credentials'
            ? 'Credentials held by members, who manages them, and who holds them.'
            : undefined
        }
      />
      {tabs.length > 1 ? <PageTabs items={tabs} /> : null}
      <Outlet />
    </AppPage>
  );
}
