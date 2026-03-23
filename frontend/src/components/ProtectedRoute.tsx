import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
  serverAdminOnly?: boolean;
  leagueManagerOnly?: boolean;
  leagueManagerGlobalOnly?: boolean;
  contentAdminOnly?: boolean;
  sponsorAdminOnly?: boolean;
  unauthenticatedRedirectTo?: string;
}

export function ProtectedRoute({
  children,
  adminOnly = false,
  serverAdminOnly = false,
  leagueManagerOnly = false,
  leagueManagerGlobalOnly = false,
  contentAdminOnly = false,
  sponsorAdminOnly = false,
  unauthenticatedRedirectTo = '/login',
}: ProtectedRouteProps) {
  const { member, token, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!token || !member) {
    return <Navigate to={unauthenticatedRedirectTo} state={{ from: location }} replace />;
  }

  if (serverAdminOnly && !member.isServerAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (adminOnly && !(member.isAdmin || member.isServerAdmin)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (leagueManagerGlobalOnly && !(member.isAdmin || member.isLeagueAdministratorGlobal)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (
    leagueManagerOnly &&
    !(
      member.isAdmin ||
      member.isLeagueAdministrator ||
      (member.leagueManagerLeagueIds?.length ?? 0) > 0
    )
  ) {
    return <Navigate to="/dashboard" replace />;
  }

  if (contentAdminOnly && !(member.isContentAdmin ?? member.isServerAdmin)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (sponsorAdminOnly && !(member.isSponsorAdmin ?? member.isServerAdmin)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
