import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AlertProvider } from './contexts/AlertContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { MemberOptionsProvider } from './contexts/MemberOptionsContext';
import { LeagueOptionsProvider } from './contexts/LeagueOptionsContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import PublicLightThemeOutlet from './components/PublicLightThemeOutlet';
import AuthenticatedAppShell from './components/AuthenticatedAppShell';
import EventManageRoute from './pages/admin/EventManageRoute';
import Login from './pages/Login';
import PublicHomePage from './pages/PublicHomePage';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const SetAvailability = lazy(() => import('./pages/SetAvailability'));
const RequestSpare = lazy(() => import('./pages/RequestSpare'));
const RespondToSpare = lazy(() => import('./pages/RespondToSpare'));
const DeclineSpare = lazy(() => import('./pages/DeclineSpare'));
const MyRequests = lazy(() => import('./pages/MyRequests'));
const MembersDirectory = lazy(() => import('./pages/MembersDirectory'));
const Profile = lazy(() => import('./pages/Profile'));
const ProfilePaymentDetailPage = lazy(() => import('./pages/ProfilePaymentDetailPage'));
const PublicPaymentDetailPage = lazy(() => import('./pages/PublicPaymentDetailPage'));
const AdminMembers = lazy(() => import('./pages/admin/AdminMembers'));
const AdminWaivers = lazy(() => import('./pages/admin/AdminWaivers'));
const AdminSheets = lazy(() => import('./pages/admin/AdminSheets'));
const AdminConfig = lazy(() => import('./pages/admin/AdminConfig'));
const AdminDatabaseConfig = lazy(() => import('./pages/admin/AdminDatabaseConfig'));
const Help = lazy(() => import('./pages/Help'));
const QuickStart = lazy(() => import('./pages/help/QuickStart'));
const RequestingSpare = lazy(() => import('./pages/help/RequestingSpare'));
const Responding = lazy(() => import('./pages/help/Responding'));
const PublicVsPrivate = lazy(() => import('./pages/help/PublicVsPrivate'));
const Notifications = lazy(() => import('./pages/help/Notifications'));
const Authentication = lazy(() => import('./pages/help/Authentication'));
const EmailSMS = lazy(() => import('./pages/help/EmailSMS'));
const Availability = lazy(() => import('./pages/help/Availability'));
const ManagingRequests = lazy(() => import('./pages/help/ManagingRequests'));
const Install = lazy(() => import('./pages/Install'));
const Feedback = lazy(() => import('./pages/Feedback'));
const AdminFeedback = lazy(() => import('./pages/admin/AdminFeedback'));
const AdminContent = lazy(() => import('./pages/admin/AdminContent'));
const AdminArticleDraftPreview = lazy(() => import('./pages/admin/AdminArticleDraftPreview'));
const AdminEventRegistrationPreview = lazy(() => import('./pages/admin/AdminEventRegistrationPreview'));
const AdminArticleEditor = lazy(() => import('./pages/admin/AdminArticleEditor'));
const AdminArticleVersionPreview = lazy(() => import('./pages/admin/AdminArticleVersionPreview'));
const AdminObservability = lazy(() => import('./pages/admin/AdminObservability'));
const AdminSponsorship = lazy(() => import('./pages/admin/AdminSponsorship'));
const Leagues = lazy(() => import('./pages/leagues/Leagues'));
const CopyLeaguesToSession = lazy(() => import('./pages/leagues/CopyLeaguesToSession'));
const LeagueDetail = lazy(() => import('./pages/leagues/LeagueDetail'));
const Calendar = lazy(() => import('./pages/Calendar'));
const CalendarEventFormPage = lazy(() => import('./pages/CalendarEventFormPage'));
const BookIceTime = lazy(() => import('./pages/BookIceTime'));
const PublicArticle = lazy(() => import('./pages/PublicArticle'));
const PublicContactPage = lazy(() => import('./pages/PublicContactPage'));
const PublicContactConfirmPage = lazy(() => import('./pages/PublicContactConfirmPage'));
const PublicDonatePage = lazy(() => import('./pages/PublicDonatePage'));
const PublicDuesPage = lazy(() => import('./pages/PublicDuesPage'));
const PublicDonateSuccessPage = lazy(() => import('./pages/PublicDonateSuccessPage'));
const PublicDonateCancelPage = lazy(() => import('./pages/PublicDonateCancelPage'));
const PublicMailingListPage = lazy(() => import('./pages/PublicMailingListPage'));
const ClubGovernance = lazy(() => import('./pages/ClubGovernance'));
const AdminGovernance = lazy(() => import('./pages/admin/AdminGovernance'));
const AdminRoles = lazy(() => import('./pages/admin/AdminRoles'));
const AdminPaymentsRoute = lazy(() => import('./pages/admin/AdminPaymentsRoute'));
const AdminWebhooks = lazy(() => import('./pages/admin/AdminWebhooks'));
const AdminEvents = lazy(() => import('./pages/admin/AdminEvents'));
const AdminEventEditor = lazy(() => import('./pages/admin/AdminEventEditor'));
const AdminVolunteering = lazy(() => import('./pages/admin/AdminVolunteering'));
const AdminVolunteeringPrograms = lazy(() =>
  import('./pages/admin/AdminVolunteering').then((m) => ({ default: m.AdminVolunteeringPrograms }))
);
const AdminVolunteerProgramEditor = lazy(() => import('./pages/admin/AdminVolunteerProgramEditor'));
const AdminVolunteerCredentials = lazy(() => import('./pages/admin/AdminVolunteerCredentials'));
const VolunteeringHub = lazy(() => import('./pages/VolunteeringHub'));
const MyVolunteerShifts = lazy(() => import('./pages/MyVolunteerShifts'));
const AdminEventRegistrationEditor = lazy(() => import('./pages/admin/AdminEventRegistrationEditor'));
const AdminEventScorekeeper = lazy(() => import('./pages/admin/AdminEventScorekeeper'));
const AdminRegistrationRoute = lazy(() => import('./pages/admin/AdminRegistrationRoute'));
const AdminWaitlists = lazy(() => import('./pages/admin/AdminWaitlists'));
const PublicLeaguesPage = lazy(() => import('./pages/PublicLeaguesPage'));
const PublicEventsPage = lazy(() => import('./pages/PublicEventsPage'));
const PublicSearchPage = lazy(() => import('./pages/PublicSearchPage'));
const PublicEventDetailPage = lazy(() => import('./pages/PublicEventDetailPage'));
const PublicEventTeamPage = lazy(() => import('./pages/PublicEventTeamPage'));
const PublicEventRegisterPage = lazy(() => import('./pages/PublicEventRegisterPage'));
const PublicEventRegisterSuccessPage = lazy(() => import('./pages/PublicEventRegisterSuccessPage'));
const PublicEventManageRegistrationPage = lazy(() => import('./pages/PublicEventManageRegistrationPage'));
const PublicEventWaitlistOfferPage = lazy(() => import('./pages/PublicEventWaitlistOfferPage'));
const PublicNotFoundPage = lazy(() => import('./pages/PublicNotFoundPage'));
const PublicPermalinkInfo = lazy(() => import('./pages/PublicPermalinkInfo'));
const PublicGoPermalinkRedirect = lazy(() => import('./pages/PublicGoPermalinkRedirect'));
const RegistrationShellPage = lazy(() => import('./pages/RegistrationShellPage'));
const PublicWaitlistOfferDeclinePage = lazy(() => import('./pages/PublicWaitlistOfferDeclinePage'));
const RegistrationStatusDetailPage = lazy(() => import('./pages/RegistrationStatusDetailPage'));
const WaitlistOfferAcceptPage = lazy(() => import('./pages/WaitlistOfferAcceptPage'));
const SabbaticalsExplainerPage = lazy(() => import('./pages/explainers/SabbaticalsExplainerPage'));
const WaitlistsExplainerPage = lazy(() => import('./pages/explainers/WaitlistsExplainerPage'));
const SparingExplainerPage = lazy(() => import('./pages/explainers/SparingExplainerPage'));

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

function RedirectAdminRegistrationTab() {
  const { tab } = useParams();
  return <Navigate to={tab ? `/admin/registrations/${tab}` : '/admin/registrations'} replace />;
}

/** React Router param regex like `(?!view$)[a-z]…` does not match in v6; dispatch reserved segments here instead. */
function RegistrationShellStepRoute() {
  const { step } = useParams();
  if (step === 'view' || (step != null && /^\d+$/.test(step))) {
    return <Navigate to="/registration/view/1" replace />;
  }
  return <RegistrationShellPage />;
}

function LegacyPublicLeaguesRedirect() {
  const location = useLocation();
  return <Navigate to={`/leagues/public${location.search}${location.hash}`} replace />;
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
                    path="/install"
                    element={
                      <Suspense fallback={null}>
                        <Install />
                      </Suspense>
                    }
                  />

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
                      <Route path="/dues" element={<PublicDuesPage />} />
                      <Route path="/donate/success" element={<PublicDonateSuccessPage />} />
                      <Route path="/donate/cancel" element={<PublicDonateCancelPage />} />
                      <Route path="/mailing-list/:listSlug" element={<PublicMailingListPage />} />
                      <Route path="/articles" element={<Navigate to="/" replace />} />
                      <Route path="/articles/:slug" element={<PublicArticle />} />
                      <Route path="/article/:slug" element={<PublicArticle />} />

                      <Route path="/events" element={<PublicEventsPage />} />
                      <Route path="/search" element={<PublicSearchPage />} />
                      <Route path="/public/leagues" element={<LegacyPublicLeaguesRedirect />} />
                      <Route path="/leagues/public" element={<PublicLeaguesPage />} />
                      <Route path="/events/:slug/teams/:teamId" element={<PublicEventTeamPage />} />
                      <Route path="/events/:slug" element={<PublicEventDetailPage />} />
                      <Route path="/events/:slug/register" element={<PublicEventRegisterPage />} />
                      <Route path="/events/:slug/register/success" element={<PublicEventRegisterSuccessPage />} />
                      <Route path="/events/registrations/manage/:accessToken" element={<PublicEventManageRegistrationPage />} />
                      <Route path="/events/waitlist-offers/:responseToken" element={<PublicEventWaitlistOfferPage />} />
                      <Route path="/registration/start" element={<RegistrationShellPage />} />
                      <Route path="/registration/success" element={<RegistrationShellPage />} />
                      <Route path="/registration/cancel" element={<RegistrationShellPage />} />
                      <Route path="/registration/:step" element={<RegistrationShellStepRoute />} />

                      <Route path="/go/:slug/info" element={<PublicPermalinkInfo />} />
                      {/* Server redirect + hit tracking; force a document load for SPA Link/navigate. */}
                      <Route path="/go/:slug" element={<PublicGoPermalinkRedirect />} />

                      <Route path="/explainers/sabbaticals" element={<SabbaticalsExplainerPage />} />
                      <Route path="/explainers/waitlists" element={<WaitlistsExplainerPage />} />
                      <Route path="/explainers/sparing" element={<SparingExplainerPage />} />

                      <Route path="/calendar/public" element={<Calendar publicMode />} />

                      <Route
                        path="/admin/content/articles/:id/versions/:versionId/preview"
                        element={
                          <ProtectedRoute>
                            <AdminArticleVersionPreview />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/admin/content/articles/draft-preview"
                        element={
                          <ProtectedRoute>
                            <AdminArticleDraftPreview />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/admin/events/registration-preview"
                        element={
                          <EventManageRoute access="preview">
                            <Suspense fallback={null}>
                              <AdminEventRegistrationPreview />
                            </Suspense>
                          </EventManageRoute>
                        }
                      />

                      <Route path="*" element={<PublicNotFoundPage />} />
                    </Route>

                    <Route element={<AuthenticatedAppShell />}>
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

                      <Route path="/registration/:registrationId(\\d+)" element={<LegacyRegistrationDetailRedirect />} />

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
                            <RequestSpare />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/request-spare/new"
                        element={<Navigate to="/request-spare" replace />}
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
                        path="/volunteering"
                        element={
                          <ProtectedRoute>
                            <VolunteeringHub />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/volunteering/my-shifts"
                        element={
                          <ProtectedRoute>
                            <MyVolunteerShifts />
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
                          <EventManageRoute access="list">
                            <AdminEvents />
                          </EventManageRoute>
                        }
                      />
                      <Route
                        path="/admin/events/:id"
                        element={
                          <EventManageRoute access="event">
                            <AdminEventEditor />
                          </EventManageRoute>
                        }
                      />
                      <Route
                        path="/admin/events/:id/scorekeeper"
                        element={
                          <EventManageRoute access="event">
                            <AdminEventScorekeeper />
                          </EventManageRoute>
                        }
                      />
                      <Route
                        path="/admin/events/:id/registrations/:registrationId"
                        element={
                          <EventManageRoute access="event">
                            <AdminEventRegistrationEditor />
                          </EventManageRoute>
                        }
                      />
                      <Route
                        path="/admin/events/:id/:tab"
                        element={
                          <EventManageRoute access="event">
                            <AdminEventEditor />
                          </EventManageRoute>
                        }
                      />
                      <Route
                        path="/admin/volunteering"
                        element={
                          <ProtectedRoute>
                            <AdminVolunteering />
                          </ProtectedRoute>
                        }
                      >
                        <Route index element={<AdminVolunteeringPrograms />} />
                        <Route path="credentials" element={<AdminVolunteerCredentials />} />
                      </Route>
                      <Route
                        path="/admin/volunteering/:id/:tab?"
                        element={
                          <ProtectedRoute>
                            <AdminVolunteerProgramEditor />
                          </ProtectedRoute>
                        }
                      />
                      <Route path="/admin/registration" element={<Navigate to="/admin/registrations" replace />} />
                      <Route
                        path="/admin/registration/communications"
                        element={<Navigate to="/admin/registrations/communications" replace />}
                      />
                      <Route path="/admin/registration/:tab" element={<RedirectAdminRegistrationTab />} />
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
                      <Route path="/admin/registrations" element={<AdminRegistrationRoute />} />
                      <Route path="/admin/registrations/:segment" element={<AdminRegistrationRoute />} />
                      <Route path="/admin/payments" element={<AdminPaymentsRoute />} />
                      <Route path="/admin/payments/:segment" element={<AdminPaymentsRoute />} />
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
                      <Route path="/admin/content" element={<Navigate to="/admin/content/articles" replace />} />
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
                    </Route>

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
