import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FirstLogin from './pages/FirstLogin';
import SetAvailability from './pages/SetAvailability';
import RequestSpare from './pages/RequestSpare';
import RespondToSpare from './pages/RespondToSpare';
import MyRequests from './pages/MyRequests';
import Unsubscribe from './pages/Unsubscribe';
import MembersDirectory from './pages/MembersDirectory';
import Profile from './pages/Profile';
import AdminMembers from './pages/admin/AdminMembers';
import AdminLeagues from './pages/admin/AdminLeagues';
import AdminConfig from './pages/admin/AdminConfig';
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

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
            path="/admin/leagues"
            element={
              <ProtectedRoute adminOnly>
                <AdminLeagues />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/config"
            element={
              <ProtectedRoute adminOnly>
                <AdminConfig />
              </ProtectedRoute>
            }
          />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
