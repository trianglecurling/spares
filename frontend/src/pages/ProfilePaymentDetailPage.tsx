import { Navigate, useParams } from 'react-router-dom';

export default function ProfilePaymentDetailPage() {
  const { orderToken } = useParams<{ orderToken: string }>();

  if (!orderToken) {
    return <Navigate to="/profile/payment-history" replace />;
  }

  return <Navigate to={`/payments/${orderToken}`} replace />;
}
