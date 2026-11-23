import { useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import PageTabs from '../../components/PageTabs';

type FacilityTab = 'sheets' | 'stones' | 'building-access';

const TAB_DESCRIPTIONS: Record<FacilityTab, string> = {
  sheets: 'Club ice sheets used for scheduling, bookings, and tournament draws.',
  stones: 'Where every curling stone is in play, plus rotations and running-surface maintenance. Stone data is public.',
  'building-access': 'Building access code and instructions shown to current members.',
};

export default function AdminFacilityInfo() {
  const location = useLocation();

  const activeTab: FacilityTab = location.pathname.includes('/building-access')
    ? 'building-access'
    : location.pathname.includes('/stones')
      ? 'stones'
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
        key: 'stones',
        label: 'Stones',
        to: '/admin/facility/stones',
        isActive: activeTab === 'stones',
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
      <AppPageHeader title="Manage facility info" description={TAB_DESCRIPTIONS[activeTab]} />
      <PageTabs items={tabs} />
      <Outlet />
    </AppPage>
  );
}
