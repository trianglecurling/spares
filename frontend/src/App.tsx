import { BrowserRouter, Routes, Route, Navigate, useParams, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AlertProvider } from './contexts/AlertContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { MemberOptionsProvider } from './contexts/MemberOptionsContext';
import { LeagueOptionsProvider } from './contexts/LeagueOptionsContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SetAvailability from './pages/SetAvailability';
import RequestSpare from './pages/RequestSpare';
import RequestSpareConfirm from './pages/RequestSpareConfirm';
import RespondToSpare from './pages/RespondToSpare';
import DeclineSpare from './pages/DeclineSpare';
import MyRequests from './pages/MyRequests';
import Unsubscribe from './pages/Unsubscribe';
import MembersDirectory from './pages/MembersDirectory';
import Profile from './pages/Profile';
import ProfilePaymentDetailPage from './pages/ProfilePaymentDetailPage';
import PublicPaymentDetailPage from './pages/PublicPaymentDetailPage';
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
import AdminArticleDraftPreview from './pages/admin/AdminArticleDraftPreview';
import AdminArticleEditor from './pages/admin/AdminArticleEditor';
import AdminArticleVersionPreview from './pages/admin/AdminArticleVersionPreview';
import AdminObservability from './pages/admin/AdminObservability';
import AdminSponsorship from './pages/admin/AdminSponsorship';
import Leagues from './pages/leagues/Leagues';
import CopyLeaguesToSession from './pages/leagues/CopyLeaguesToSession';
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
import AdminWebhooks from './pages/admin/AdminWebhooks';
import AdminEvents from './pages/admin/AdminEvents';
import AdminEventEditor from './pages/admin/AdminEventEditor';
import AdminEventRegistrationEditor from './pages/admin/AdminEventRegistrationEditor';
import AdminRegistrationConfig from './pages/admin/AdminRegistrationConfig';
import AdminWaitlists from './pages/admin/AdminWaitlists';
import AdminRegistrationCommunications from './pages/admin/AdminRegistrationCommunications';
import AdminRegistrations from './pages/admin/AdminRegistrations';
import AdminRegistrationDetail from './pages/admin/AdminRegistrationDetail';
import PublicEventsPage from './pages/PublicEventsPage';
import PublicEventDetailPage from './pages/PublicEventDetailPage';
import PublicEventTeamPage from './pages/PublicEventTeamPage';
import PublicEventRegisterPage from './pages/PublicEventRegisterPage';
import PublicEventRegisterSuccessPage from './pages/PublicEventRegisterSuccessPage';
import PublicPermalinkInfo from './pages/PublicPermalinkInfo';
import PublicLightThemeOutlet from './components/PublicLightThemeOutlet';
import RegistrationShellPage from './pages/RegistrationShellPage';
import PublicWaitlistOfferDeclinePage from './pages/PublicWaitlistOfferDeclinePage';
import RegistrationStatusDetailPage from './pages/RegistrationStatusDetailPage';
import WaitlistOfferAcceptPage from './pages/WaitlistOfferAcceptPage';

function LeagueSetupRedirect({ defaultTab }: { defaultTab: string }) {
  const { leagueId, tab } = useParams();
  const targetTab = tab || defaultTab;
  if (!leagueId) {
    return <Navigate to="/leagues" replace />;
  }
  const targetPath = targetTab ? `/leagues/${leagueId}/${targetTab}` : `/leagues/${leagueId}`;
  return <Navigate to={targetPath} replace />;
}

function LegacyRegistrationDetailRedirect() {
  return <Navigate to="/registration/view/1" replace />;
}

function RegistrationViewIndexRedirect() {
  return <Navigate to="/registration/view/1" replace />;
}

/** React Router param regex like `(?!view$)[a-z]…` does not match in v6; dispatch reserved segments here instead. */
function RegistrationShellStepRoute() {
  const { step } = useParams();
  if (step === 'view' || (step != null && /^\d+$/.test(step))) {
    return <Navigate to="/registration/view/1" replace />;
  }
  return <RegistrationShellPage />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <AlertProvider>
            <ConfirmProvider>
              <MemberOptionsProvider>
                <LeagueOptionsProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route
                    path="/unsubscribe"
                    element={
                      <ProtectedRoute>
                        <Unsubscribe />
                      </ProtectedRoute>
                    }
                  />
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
                  <Route path="/payments/:orderToken" element={<PublicPaymentDetailPage />} />
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
                  <Route path="/registration/start" element={<RegistrationShellPage />} />
                  <Route path="/registration/success" element={<RegistrationShellPage />} />
                  <Route path="/registration/cancel" element={<RegistrationShellPage />} />
                  <Route path="/registration/:step" element={<RegistrationShellStepRoute />} />

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
                  path="/registration/view/:slot"
                  element={
                    <ProtectedRoute>
                      <RegistrationStatusDetailPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/registration/view"
                  element={
                    <ProtectedRoute>
                      <RegistrationViewIndexRedirect />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/registration/:registrationId(\\d+)"
                  element={<LegacyRegistrationDetailRedirect />}
                />

                <Route
                  path="/registration/waitlist-offers/:offerId/accept"
                  element={
                    <ProtectedRoute>
                      <WaitlistOfferAcceptPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/registration/waitlist-offers/:offerId/decline"
                  element={
                    <ProtectedRoute>
                      <PublicWaitlistOfferDeclinePage />
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
                <Route path="/profile" element={<Navigate to="/profile/preferences" replace />} />
                <Route
                  path="/profile/payment-history/:orderToken"
                  element={
                    <ProtectedRoute>
                      <ProfilePaymentDetailPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/profile/:tab"
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
                  path="/leagues/copy-to-session"
                  element={
                    <ProtectedRoute>
                      <CopyLeaguesToSession />
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
                  path="/admin/registration"
                  element={<Navigate to="/admin/registration/seasons" replace />}
                />
                <Route
                  path="/waitlists"
                  element={
                    <ProtectedRoute>
                      <AdminWaitlists />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/waitlists/:waitlistId"
                  element={
                    <ProtectedRoute>
                      <AdminWaitlists />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/registrations"
                  element={
                    <ProtectedRoute anyOfScopes={['registrations.manage', 'admin.manage']}>
                      <AdminRegistrations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/registrations/:registrationId"
                  element={
                    <ProtectedRoute anyOfScopes={['registrations.manage', 'admin.manage']}>
                      <AdminRegistrationDetail />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/registration/communications"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminRegistrationCommunications />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/registration/:tab"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminRegistrationConfig />
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
                  path="/admin/webhooks"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminWebhooks />
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
                  path="/admin/content/articles/draft-preview"
                  element={
                    <ProtectedRoute contentAdminOnly>
                      <AdminArticleDraftPreview />
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
              </LeagueOptionsProvider>
              </MemberOptionsProvider>
            </ConfirmProvider>
          </AlertProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
