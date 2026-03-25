import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { memberHasScope } from '../utils/permissions';

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

  if (adminOnly && !memberHasScope(member, 'admin.manage')) {
    return <Navigate to="/dashboard" replace />;
  }

  if (leagueManagerGlobalOnly && !memberHasScope(member, 'leagues.manage')) {
    return <Navigate to="/dashboard" replace />;
  }

  if (
    leagueManagerOnly &&
    !memberHasScope(member, 'leagues.manage')
  ) {
    return <Navigate to="/dashboard" replace />;
  }

  if (contentAdminOnly && !memberHasScope(member, 'content.manage')) {
    return <Navigate to="/dashboard" replace />;
  }

  if (sponsorAdminOnly && !memberHasScope(member, 'sponsorship.manage')) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
