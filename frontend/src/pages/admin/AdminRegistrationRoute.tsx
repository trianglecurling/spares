import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import AdminRegistrationConfig from './AdminRegistrationConfig';
import AdminRegistrationCreate from './AdminRegistrationCreate';
import AdminRegistrationDetail from './AdminRegistrationDetail';

const SETTINGS_TABS = new Set(['seasons', 'sessions', 'periods', 'prices', 'discounts']);

function ConfigPage() {
  return (
    <ProtectedRoute anyOfScopes={['registrations.manage', 'admin.manage']}>
      <AdminRegistrationConfig />
    </ProtectedRoute>
  );
}

export default function AdminRegistrationRoute() {
  const { segment, subsegment } = useParams<{ segment?: string; subsegment?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  if (segment === 'communications') {
    return <Navigate to="/admin/registrations" replace />;
  }

  if (segment === 'new') {
    return (
      <ProtectedRoute anyOfScopes={['registrations.manage', 'admin.manage']}>
        <AdminRegistrationCreate />
      </ProtectedRoute>
    );
  }

  if (segment && /^\d+$/.test(segment)) {
    return (
      <ProtectedRoute anyOfScopes={['registrations.manage', 'admin.manage']}>
        <AdminRegistrationDetail />
      </ProtectedRoute>
    );
  }

  if (!segment) {
    const hasListQuery =
      Boolean(searchParams.get('q')) || Boolean(searchParams.get('search')) || Boolean(searchParams.get('status'));
    if (hasListQuery) {
      return <Navigate to={`/admin/registrations/list${location.search}`} replace />;
    }
    return <ConfigPage />;
  }

  if (segment === 'list') {
    if (subsegment) {
      return <Navigate to={`/admin/registrations/list${location.search}`} replace />;
    }
    return <ConfigPage />;
  }

  if (segment === 'settings') {
    if (!subsegment || !SETTINGS_TABS.has(subsegment)) {
      return <Navigate to="/admin/registrations/settings/seasons" replace />;
    }
    return <ConfigPage />;
  }

  if (SETTINGS_TABS.has(segment) && !subsegment) {
    return <Navigate to={`/admin/registrations/settings/${segment}`} replace />;
  }

  return <Navigate to="/admin/registrations" replace />;
}
