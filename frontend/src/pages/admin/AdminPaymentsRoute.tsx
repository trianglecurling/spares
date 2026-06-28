import { useParams } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import AdminPayments from './AdminPayments';

export default function AdminPaymentsRoute() {
  const { segment } = useParams<{ segment?: string }>();
  const activeTab = segment === 'item-names' ? 'item-names' : 'activity';

  return (
    <ProtectedRoute requiredScope="payments.read">
      <AdminPayments activeTab={activeTab} />
    </ProtectedRoute>
  );
}
