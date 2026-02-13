import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
  serverAdminOnly?: boolean;
  leagueManagerOnly?: boolean;
  leagueManagerGlobalOnly?: boolean;
}

export function ProtectedRoute({
  children,
  adminOnly = false,
  serverAdminOnly = false,
  leagueManagerOnly = false,
  leagueManagerGlobalOnly = false,
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
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (serverAdminOnly && !member.isServerAdmin) {
    return <Navigate to="/" replace />;
  }

  if (adminOnly && !member.isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (leagueManagerGlobalOnly && !(member.isAdmin || member.isLeagueAdministratorGlobal)) {
    return <Navigate to="/" replace />;
  }

  if (
    leagueManagerOnly &&
    !(
      member.isAdmin ||
      member.isLeagueAdministrator ||
      (member.leagueManagerLeagueIds?.length ?? 0) > 0
    )
  ) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
