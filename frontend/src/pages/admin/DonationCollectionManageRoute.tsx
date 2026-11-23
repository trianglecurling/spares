import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import AppStateCard from '../../components/AppStateCard';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../utils/api';
import {
  memberCanAccessDonationCollectionsAdmin,
  memberCanManageDonationCollectionFromClaims,
  memberHasDonationsManageScope,
} from '../../utils/donationCollectionAccess';

type DonationCollectionManageAccess = 'list' | 'collection';

type DonationCollectionManageRouteProps = {
  children: React.ReactNode;
  access: DonationCollectionManageAccess;
};

function DonationCollectionManageAccessGate({ children, access }: DonationCollectionManageRouteProps) {
  const { member } = useAuth();
  const { id } = useParams<{ id?: string }>();
  const canManageAll = memberHasDonationsManageScope(member);
  const canAccessFromClaims = memberCanAccessDonationCollectionsAdmin(member);
  const [remoteAllowed, setRemoteAllowed] = useState<boolean | null>(null);

  const collectionId = id && id !== 'new' ? Number.parseInt(id, 10) : null;
  const needsCollectionRemoteCheck =
    access === 'collection' &&
    !canManageAll &&
    collectionId != null &&
    Number.isFinite(collectionId) &&
    !memberCanManageDonationCollectionFromClaims(member, collectionId);
  const needsListRemoteCheck = access === 'list' && !canManageAll && !canAccessFromClaims;

  useEffect(() => {
    if (needsCollectionRemoteCheck && collectionId != null) {
      let cancelled = false;
      setRemoteAllowed(null);
      api
        .get(`/donation-collections/${collectionId}/management-access`)
        .then(() => {
          if (!cancelled) setRemoteAllowed(true);
        })
        .catch(() => {
          if (!cancelled) setRemoteAllowed(false);
        });
      return () => {
        cancelled = true;
      };
    }

    if (needsListRemoteCheck) {
      let cancelled = false;
      setRemoteAllowed(null);
      api
        .get('/donation-collections')
        .then(() => {
          if (!cancelled) setRemoteAllowed(true);
        })
        .catch(() => {
          if (!cancelled) setRemoteAllowed(false);
        });
      return () => {
        cancelled = true;
      };
    }

    setRemoteAllowed(null);
  }, [needsCollectionRemoteCheck, needsListRemoteCheck, collectionId]);

  if (canManageAll) return <>{children}</>;

  if (access === 'list') {
    if (canAccessFromClaims) return <>{children}</>;
    if (needsListRemoteCheck) {
      if (remoteAllowed === null) return <AppStateCard title="Loading..." />;
      if (remoteAllowed) return <>{children}</>;
    }
    return <Navigate to="/dashboard" replace />;
  }

  if (id === 'new') return <Navigate to="/dashboard" replace />;
  if (collectionId == null || !Number.isFinite(collectionId)) {
    return <Navigate to="/dashboard" replace />;
  }
  if (memberCanManageDonationCollectionFromClaims(member, collectionId)) return <>{children}</>;
  if (needsCollectionRemoteCheck) {
    if (remoteAllowed === null) return <AppStateCard title="Loading..." />;
    if (remoteAllowed) return <>{children}</>;
  }
  return <Navigate to="/dashboard" replace />;
}

/**
 * Allows donations.manage, or a member listed as a manager of this collection.
 * Create (`/admin/donations/new`) still requires donations.manage.
 */
export default function DonationCollectionManageRoute({
  children,
  access,
}: DonationCollectionManageRouteProps) {
  return (
    <ProtectedRoute>
      <DonationCollectionManageAccessGate access={access}>{children}</DonationCollectionManageAccessGate>
    </ProtectedRoute>
  );
}
