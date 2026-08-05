import { useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import PageTabs from '../../components/PageTabs';

type FacilityTab = 'sheets' | 'building-access';

export default function AdminFacilityInfo() {
  const location = useLocation();

  const activeTab: FacilityTab = location.pathname.includes('/building-access')
    ? 'building-access'
    : 'sheets';

  const tabs = useMemo(
    () => [
      {
        key: 'sheets',
        label: 'Sheets',
        to: '/admin/facility',
        isActive: activeTab === 'sheets',
      },
      {
        key: 'building-access',
        label: 'Building access',
        to: '/admin/facility/building-access',
        isActive: activeTab === 'building-access',
      },
    ],
    [activeTab],
  );

  return (
    <AppPage>
      <AppPageHeader
        title="Manage facility info"
        description={
          activeTab === 'building-access'
            ? 'Building access code and instructions shown to current members.'
            : 'Club ice sheets used for scheduling, bookings, and tournament draws.'
        }
      />
      <PageTabs items={tabs} />
      <Outlet />
    </AppPage>
  );
}
