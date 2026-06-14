import { useParams } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import AdminRegistrationConfig from './AdminRegistrationConfig';
import AdminRegistrationDetail from './AdminRegistrationDetail';

export default function AdminRegistrationRoute() {
  const { segment } = useParams<{ segment?: string }>();

  if (segment && /^\d+$/.test(segment)) {
    return (
      <ProtectedRoute anyOfScopes={['registrations.manage', 'admin.manage']}>
        <AdminRegistrationDetail />
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute anyOfScopes={['registrations.manage', 'admin.manage']}>
      <AdminRegistrationConfig />
    </ProtectedRoute>
  );
}
