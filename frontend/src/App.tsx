import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AlertProvider } from './contexts/AlertContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FirstLogin from './pages/FirstLogin';
import SetAvailability from './pages/SetAvailability';
import RequestSpare from './pages/RequestSpare';
import RequestSpareConfirm from './pages/RequestSpareConfirm';
import RespondToSpare from './pages/RespondToSpare';
import DeclineSpare from './pages/DeclineSpare';
import MyRequests from './pages/MyRequests';
import Unsubscribe from './pages/Unsubscribe';
import MembersDirectory from './pages/MembersDirectory';
import Profile from './pages/Profile';
import AdminMembers from './pages/admin/AdminMembers';
import AdminSheets from './pages/admin/AdminSheets';
import AdminConfig from './pages/admin/AdminConfig';
import AdminDatabaseConfig from './pages/admin/AdminDatabaseConfig';
import Help from './pages/Help';
import QuickStart from './pages/help/QuickStart';
import RequestingSpare from './pages/help/RequestingSpare';
import Responding from './pages/help/Responding';
import PublicVsPrivate from './pages/help/PublicVsPrivate';
import Notifications from './pages/help/Notifications';
import Authentication from './pages/help/Authentication';
import EmailSMS from './pages/help/EmailSMS';
import Availability from './pages/help/Availability';
import ManagingRequests from './pages/help/ManagingRequests';
import Install from './pages/Install';
import Feedback from './pages/Feedback';
import AdminFeedback from './pages/admin/AdminFeedback';
import AdminObservability from './pages/admin/AdminObservability';
import Leagues from './pages/leagues/Leagues';
import LeagueDetail from './pages/leagues/LeagueDetail';

function LeagueSetupRedirect({ defaultTab }: { defaultTab: string }) {
  const { leagueId, tab } = useParams();
  const targetTab = tab || defaultTab;
  if (!leagueId) {
    return <Navigate to="/leagues" replace />;
  }
  const targetPath = targetTab ? `/leagues/${leagueId}/${targetTab}` : `/leagues/${leagueId}`;
  return <Navigate to={targetPath} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <AlertProvider>
            <ConfirmProvider>
            <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/unsubscribe" element={<Unsubscribe />} />
          <Route path="/install" element={<Install />} />
          
          {/* Help pages - accessible without authentication */}
          <Route path="/help" element={<Help />} />
          <Route path="/help/quick-start" element={<QuickStart />} />
          <Route path="/help/requesting-spare" element={<RequestingSpare />} />
          <Route path="/help/responding" element={<Responding />} />
          <Route path="/help/public-vs-private" element={<PublicVsPrivate />} />
          <Route path="/help/notifications" element={<Notifications />} />
          <Route path="/help/authentication" element={<Authentication />} />
          <Route path="/help/email-sms" element={<EmailSMS />} />
          <Route path="/help/availability" element={<Availability />} />
          <Route path="/help/managing-requests" element={<ManagingRequests />} />
          <Route path="/feedback" element={<Feedback />} />
          
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/first-login"
            element={
              <ProtectedRoute>
                <FirstLogin />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/availability"
            element={
              <ProtectedRoute>
                <SetAvailability />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/request-spare"
            element={
              <ProtectedRoute>
                <RequestSpareConfirm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/request-spare/new"
            element={
              <ProtectedRoute>
                <RequestSpare />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/spare-request/respond"
            element={
              <ProtectedRoute>
                <RespondToSpare />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/spare-request/decline"
            element={
              <ProtectedRoute>
                <DeclineSpare />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/my-requests"
            element={
              <ProtectedRoute>
                <MyRequests />
              </ProtectedRoute>
            }
          />

          <Route
            path="/members"
            element={
              <ProtectedRoute>
                <MembersDirectory />
              </ProtectedRoute>
            }
          />

          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/admin/members"
            element={
              <ProtectedRoute adminOnly>
                <AdminMembers />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/leagues"
            element={
              <ProtectedRoute>
                <Leagues />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leagues/:leagueId"
            element={
              <ProtectedRoute>
                <LeagueDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leagues/:leagueId/:tab"
            element={
              <ProtectedRoute>
                <LeagueDetail />
              </ProtectedRoute>
            }
          />
          <Route path="/admin/leagues" element={<Navigate to="/leagues" replace />} />
          <Route
            path="/admin/leagues/:leagueId/setup"
            element={<LeagueSetupRedirect defaultTab="" />}
          />
          <Route
            path="/admin/leagues/:leagueId/setup/:tab"
            element={<LeagueSetupRedirect defaultTab="" />}
          />
          <Route
            path="/admin/sheets"
            element={
              <ProtectedRoute leagueManagerOnly>
                <AdminSheets />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/config"
            element={
              <ProtectedRoute serverAdminOnly>
                <AdminConfig />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/observability"
            element={
              <ProtectedRoute serverAdminOnly>
                <AdminObservability />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/database-config"
            element={
              <ProtectedRoute adminOnly>
                <AdminDatabaseConfig />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/feedback"
            element={
              <ProtectedRoute adminOnly>
                <AdminFeedback />
              </ProtectedRoute>
            }
          />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
            </ConfirmProvider>
          </AlertProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
