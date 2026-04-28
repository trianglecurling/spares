import { BrowserRouter, Routes, Route, Navigate, useParams, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AlertProvider } from './contexts/AlertContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { MemberOptionsProvider } from './contexts/MemberOptionsContext';
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
import AdminWaivers from './pages/admin/AdminWaivers';
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
import AdminContent from './pages/admin/AdminContent';
import AdminArticleEditor from './pages/admin/AdminArticleEditor';
import AdminArticleVersionPreview from './pages/admin/AdminArticleVersionPreview';
import AdminObservability from './pages/admin/AdminObservability';
import AdminSponsorship from './pages/admin/AdminSponsorship';
import Leagues from './pages/leagues/Leagues';
import LeagueDetail from './pages/leagues/LeagueDetail';
import Calendar from './pages/Calendar';
import CalendarEventFormPage from './pages/CalendarEventFormPage';
import BookIceTime from './pages/BookIceTime';
import PublicHomePage from './pages/PublicHomePage';
import PublicArticle from './pages/PublicArticle';
import PublicContactPage from './pages/PublicContactPage';
import PublicContactConfirmPage from './pages/PublicContactConfirmPage';
import PublicDonatePage from './pages/PublicDonatePage';
import PublicDonateSuccessPage from './pages/PublicDonateSuccessPage';
import PublicDonateCancelPage from './pages/PublicDonateCancelPage';
import PublicMailingListPage from './pages/PublicMailingListPage';
import ClubGovernance from './pages/ClubGovernance';
import AdminGovernance from './pages/admin/AdminGovernance';
import AdminRoles from './pages/admin/AdminRoles';
import AdminPayments from './pages/admin/AdminPayments';
import AdminEvents from './pages/admin/AdminEvents';
import AdminEventEditor from './pages/admin/AdminEventEditor';
import AdminEventRegistrationEditor from './pages/admin/AdminEventRegistrationEditor';
import PublicEventsPage from './pages/PublicEventsPage';
import PublicEventDetailPage from './pages/PublicEventDetailPage';
import PublicEventTeamPage from './pages/PublicEventTeamPage';
import PublicEventRegisterPage from './pages/PublicEventRegisterPage';
import PublicEventRegisterSuccessPage from './pages/PublicEventRegisterSuccessPage';
import PublicPermalinkInfo from './pages/PublicPermalinkInfo';
import PublicLightThemeOutlet from './components/PublicLightThemeOutlet';

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
              <MemberOptionsProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/unsubscribe" element={<Unsubscribe />} />
                  <Route path="/install" element={<Install />} />

                {/* Help pages - accessible without authentication */}
                {/* Public marketing pages (always light); native UI matches via color-scheme */}
                <Route element={<PublicLightThemeOutlet />}>
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

                  <Route path="/" element={<PublicHomePage />} />
                  <Route path="/contact" element={<PublicContactPage />} />
                  <Route path="/contact/confirm" element={<PublicContactConfirmPage />} />
                  <Route path="/donate" element={<PublicDonatePage />} />
                  <Route path="/donate/success" element={<PublicDonateSuccessPage />} />
                  <Route path="/donate/cancel" element={<PublicDonateCancelPage />} />
                  <Route path="/mailing-list/:listSlug" element={<PublicMailingListPage />} />
                  <Route path="/articles" element={<Navigate to="/" replace />} />
                  <Route path="/articles/:slug" element={<PublicArticle />} />
                  <Route path="/article/:slug" element={<PublicArticle />} />

                  <Route path="/events" element={<PublicEventsPage />} />
                  <Route path="/events/:slug/teams/:teamId" element={<PublicEventTeamPage />} />
                  <Route path="/events/:slug" element={<PublicEventDetailPage />} />
                  <Route path="/events/:slug/register" element={<PublicEventRegisterPage />} />
                  <Route path="/events/:slug/register/success" element={<PublicEventRegisterSuccessPage />} />

                  <Route path="/go/:slug/info" element={<PublicPermalinkInfo />} />

                  <Route path="/calendar/public" element={<Calendar publicMode />} />
                </Route>

                <Route
                  path="/dashboard"
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
                  path="/governance"
                  element={
                    <ProtectedRoute>
                      <ClubGovernance />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/calendar"
                  element={
                    <ProtectedRoute unauthenticatedRedirectTo="/calendar/public">
                      <Outlet />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Calendar />} />
                  <Route path="events/new" element={<CalendarEventFormPage />} />
                  <Route path="events/edit/*" element={<CalendarEventFormPage />} />
                </Route>
                <Route
                  path="/book-ice"
                  element={
                    <ProtectedRoute>
                      <BookIceTime />
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
                  path="/admin/waivers"
                  element={
                    <ProtectedRoute anyOfScopes={['members.manage', 'events.manage']}>
                      <AdminWaivers />
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
                  path="/admin/sponsorship"
                  element={
                    <ProtectedRoute sponsorAdminOnly>
                      <AdminSponsorship />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/governance"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminGovernance />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/roles"
                  element={
                    <ProtectedRoute serverAdminOnly>
                      <AdminRoles />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/events"
                  element={
                    <ProtectedRoute requiredScope="events.manage">
                      <AdminEvents />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/events/:id"
                  element={
                    <ProtectedRoute requiredScope="events.manage">
                      <AdminEventEditor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/events/:id/:tab"
                  element={
                    <ProtectedRoute requiredScope="events.manage">
                      <AdminEventEditor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/events/:id/registrations/:registrationId"
                  element={
                    <ProtectedRoute requiredScope="events.manage">
                      <AdminEventRegistrationEditor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/payments"
                  element={
                    <ProtectedRoute requiredScope="payments.read">
                      <AdminPayments />
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
                <Route
                  path="/admin/content"
                  element={<Navigate to="/admin/content/site" replace />}
                />
                <Route
                  path="/admin/content/articles/:id/versions/:versionId/preview"
                  element={
                    <ProtectedRoute contentAdminOnly>
                      <AdminArticleVersionPreview />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/content/articles/:id"
                  element={
                    <ProtectedRoute contentAdminOnly>
                      <AdminArticleEditor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/content/:tab"
                  element={
                    <ProtectedRoute contentAdminOnly>
                      <AdminContent />
                    </ProtectedRoute>
                  }
                />

                <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </MemberOptionsProvider>
            </ConfirmProvider>
          </AlertProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
