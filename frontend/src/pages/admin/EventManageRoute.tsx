import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import AppStateCard from '../../components/AppStateCard';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../utils/api';
import {
  memberCanAccessEventsAdmin,
  memberCanManageEventFromClaims,
  memberHasEventsManageScope,
} from '../../utils/eventManagementAccess';

type EventManageAccess = 'list' | 'event' | 'preview';

type EventManageRouteProps = {
  children: React.ReactNode;
  access: EventManageAccess;
};

function EventManageAccessGate({ children, access }: EventManageRouteProps) {
  const { member } = useAuth();
  const { id } = useParams<{ id?: string }>();
  const canManageAll = memberHasEventsManageScope(member);
  const canAccessFromClaims = memberCanAccessEventsAdmin(member);
  const [remoteAllowed, setRemoteAllowed] = useState<boolean | null>(null);

  const eventId = id && id !== 'new' ? Number.parseInt(id, 10) : null;
  const needsEventRemoteCheck =
    access === 'event' &&
    !canManageAll &&
    eventId != null &&
    Number.isFinite(eventId) &&
    !memberCanManageEventFromClaims(member, eventId);

  const needsListRemoteCheck =
    (access === 'list' || access === 'preview') && !canManageAll && !canAccessFromClaims;

  useEffect(() => {
    if (needsEventRemoteCheck && eventId != null) {
      let cancelled = false;
      setRemoteAllowed(null);
      api
        .get(`/events/${eventId}/management-access`)
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
        .get('/events', { params: { manageable: '1' } })
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
  }, [needsEventRemoteCheck, needsListRemoteCheck, eventId]);

  if (canManageAll) {
    return <>{children}</>;
  }

  if (access === 'list' || access === 'preview') {
    if (canAccessFromClaims) {
      return <>{children}</>;
    }
    if (needsListRemoteCheck) {
      if (remoteAllowed === null) {
        return <AppStateCard title="Loading..." />;
      }
      if (remoteAllowed) {
        return <>{children}</>;
      }
    }
    return <Navigate to="/dashboard" replace />;
  }

  // access === 'event'
  if (id === 'new') {
    return <Navigate to="/dashboard" replace />;
  }

  if (eventId == null || !Number.isFinite(eventId)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (memberCanManageEventFromClaims(member, eventId)) {
    return <>{children}</>;
  }

  if (needsEventRemoteCheck) {
    if (remoteAllowed === null) {
      return <AppStateCard title="Loading..." />;
    }
    if (remoteAllowed) {
      return <>{children}</>;
    }
  }

  return <Navigate to="/dashboard" replace />;
}

/**
 * Allows events.manage OR event owners (owned events only).
 * Create (`/admin/events/new`) still requires events.manage.
 */
export default function EventManageRoute({ children, access }: EventManageRouteProps) {
  return (
    <ProtectedRoute>
      <EventManageAccessGate access={access}>{children}</EventManageAccessGate>
    </ProtectedRoute>
  );
}
