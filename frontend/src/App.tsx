import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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
import { lazyRoute } from './utils/staleChunkReload';

const Dashboard = lazyRoute(() => import('./pages/Dashboard'));
const SetAvailability = lazyRoute(() => import('./pages/SetAvailability'));
const RequestSpare = lazyRoute(() => import('./pages/RequestSpare'));
const RespondToSpare = lazyRoute(() => import('./pages/RespondToSpare'));
const DeclineSpare = lazyRoute(() => import('./pages/DeclineSpare'));
const MyRequests = lazyRoute(() => import('./pages/MyRequests'));
const MembersDirectory = lazyRoute(() => import('./pages/MembersDirectory'));
const Profile = lazyRoute(() => import('./pages/Profile'));
const ProfilePaymentDetailPage = lazyRoute(() => import('./pages/ProfilePaymentDetailPage'));
const PublicPaymentDetailPage = lazyRoute(() => import('./pages/PublicPaymentDetailPage'));
const AdminMembers = lazyRoute(() => import('./pages/admin/AdminMembers'));
const AdminWaivers = lazyRoute(() => import('./pages/admin/AdminWaivers'));
const AdminFacilityInfo = lazyRoute(() => import('./pages/admin/AdminFacilityInfo'));
const AdminSheets = lazyRoute(() => import('./pages/admin/AdminSheets'));
const AdminBuildingAccess = lazyRoute(() => import('./pages/admin/AdminBuildingAccess'));
const BuildingAccessPage = lazyRoute(() => import('./pages/BuildingAccessPage'));
const MemberCommunicationsPage = lazyRoute(() => import('./pages/MemberCommunicationsPage'));
const BoardMeetingMinutesPage = lazyRoute(() => import('./pages/BoardMeetingMinutesPage'));
const AdminConfig = lazyRoute(() => import('./pages/admin/AdminConfig'));
const AdminDatabaseConfig = lazyRoute(() => import('./pages/admin/AdminDatabaseConfig'));
const Help = lazyRoute(() => import('./pages/Help'));
const QuickStart = lazyRoute(() => import('./pages/help/QuickStart'));
const RequestingSpare = lazyRoute(() => import('./pages/help/RequestingSpare'));
const Responding = lazyRoute(() => import('./pages/help/Responding'));
const PublicVsPrivate = lazyRoute(() => import('./pages/help/PublicVsPrivate'));
const Notifications = lazyRoute(() => import('./pages/help/Notifications'));
const Authentication = lazyRoute(() => import('./pages/help/Authentication'));
const EmailSMS = lazyRoute(() => import('./pages/help/EmailSMS'));
const Availability = lazyRoute(() => import('./pages/help/Availability'));
const ManagingRequests = lazyRoute(() => import('./pages/help/ManagingRequests'));
const Install = lazyRoute(() => import('./pages/Install'));
const Feedback = lazyRoute(() => import('./pages/Feedback'));
const AdminFeedback = lazyRoute(() => import('./pages/admin/AdminFeedback'));
const AdminContent = lazyRoute(() => import('./pages/admin/AdminContent'));
const AdminArticleDraftPreview = lazyRoute(() => import('./pages/admin/AdminArticleDraftPreview'));
const AdminEventRegistrationPreview = lazyRoute(() => import('./pages/admin/AdminEventRegistrationPreview'));
const AdminArticleEditor = lazyRoute(() => import('./pages/admin/AdminArticleEditor'));
const AdminArticleVersionPreview = lazyRoute(() => import('./pages/admin/AdminArticleVersionPreview'));
const AdminObservability = lazyRoute(() => import('./pages/admin/AdminObservability'));
const AdminSponsorship = lazyRoute(() => import('./pages/admin/AdminSponsorship'));
const Leagues = lazyRoute(() => import('./pages/leagues/Leagues'));
const CopyLeaguesToSession = lazyRoute(() => import('./pages/leagues/CopyLeaguesToSession'));
const LeagueDetail = lazyRoute(() => import('./pages/leagues/LeagueDetail'));
const Calendar = lazyRoute(() => import('./pages/Calendar'));
const CalendarEventFormPage = lazyRoute(() => import('./pages/CalendarEventFormPage'));
const BookIceTime = lazyRoute(() => import('./pages/BookIceTime'));
const PublicArticle = lazyRoute(() => import('./pages/PublicArticle'));
const MemberArticlePage = lazyRoute(() => import('./pages/MemberArticlePage'));
const PublicContactPage = lazyRoute(() => import('./pages/PublicContactPage'));
const PublicContactConfirmPage = lazyRoute(() => import('./pages/PublicContactConfirmPage'));
const PublicDonatePage = lazyRoute(() => import('./pages/PublicDonatePage'));
const PublicDuesPage = lazyRoute(() => import('./pages/PublicDuesPage'));
const PublicDonateSuccessPage = lazyRoute(() => import('./pages/PublicDonateSuccessPage'));
const PublicDonateCancelPage = lazyRoute(() => import('./pages/PublicDonateCancelPage'));
const PublicMailingListPage = lazyRoute(() => import('./pages/PublicMailingListPage'));
const ClubGovernance = lazyRoute(() => import('./pages/ClubGovernance'));
const AdminGovernance = lazyRoute(() => import('./pages/admin/AdminGovernance'));
const AdminRoles = lazyRoute(() => import('./pages/admin/AdminRoles'));
const AdminServiceAccounts = lazyRoute(() => import('./pages/admin/AdminServiceAccounts'));
const AdminPaymentsRoute = lazyRoute(() => import('./pages/admin/AdminPaymentsRoute'));
const AdminWebhooks = lazyRoute(() => import('./pages/admin/AdminWebhooks'));
const AdminEvents = lazyRoute(() => import('./pages/admin/AdminEvents'));
const AdminEventEditor = lazyRoute(() => import('./pages/admin/AdminEventEditor'));
const AdminVolunteering = lazyRoute(() => import('./pages/admin/AdminVolunteering'));
const AdminVolunteeringPrograms = lazyRoute(() =>
  import('./pages/admin/AdminVolunteering').then((m) => ({ default: m.AdminVolunteeringPrograms }))
);
const AdminVolunteerProgramEditor = lazyRoute(() => import('./pages/admin/AdminVolunteerProgramEditor'));
const AdminVolunteerCredentials = lazyRoute(() => import('./pages/admin/AdminVolunteerCredentials'));
const VolunteeringHub = lazyRoute(() => import('./pages/VolunteeringHub'));
const VolunteerProgramPage = lazyRoute(() => import('./pages/VolunteerProgramPage'));
const PublicVolunteerProgramPage = lazyRoute(() => import('./pages/PublicVolunteerProgramPage'));
const PublicVolunteerSignupManagePage = lazyRoute(
  () => import('./pages/PublicVolunteerSignupManagePage')
);
const MyVolunteerShifts = lazyRoute(() => import('./pages/MyVolunteerShifts'));
const AdminEventRegistrationEditor = lazyRoute(() => import('./pages/admin/AdminEventRegistrationEditor'));
const AdminEventScorekeeper = lazyRoute(() => import('./pages/admin/AdminEventScorekeeper'));
const AdminRegistrationRoute = lazyRoute(() => import('./pages/admin/AdminRegistrationRoute'));
const AdminWaitlists = lazyRoute(() => import('./pages/admin/AdminWaitlists'));
const PublicLeaguesPage = lazyRoute(() => import('./pages/PublicLeaguesPage'));
const PublicEventsPage = lazyRoute(() => import('./pages/PublicEventsPage'));
const PublicSearchPage = lazyRoute(() => import('./pages/PublicSearchPage'));
const PublicEventDetailPage = lazyRoute(() => import('./pages/PublicEventDetailPage'));
const PublicEventTeamPage = lazyRoute(() => import('./pages/PublicEventTeamPage'));
const PublicEventRegisterPage = lazyRoute(() => import('./pages/PublicEventRegisterPage'));
const PublicEventRegisterSuccessPage = lazyRoute(() => import('./pages/PublicEventRegisterSuccessPage'));
const PublicEventManageRegistrationPage = lazyRoute(() => import('./pages/PublicEventManageRegistrationPage'));
const PublicEventWaitlistOfferPage = lazyRoute(() => import('./pages/PublicEventWaitlistOfferPage'));
const PublicNotFoundPage = lazyRoute(() => import('./pages/PublicNotFoundPage'));
const PublicPermalinkInfo = lazyRoute(() => import('./pages/PublicPermalinkInfo'));
const PublicGoPermalinkRedirect = lazyRoute(() => import('./pages/PublicGoPermalinkRedirect'));
const RegistrationShellPage = lazyRoute(() => import('./pages/RegistrationShellPage'));
const RegistrationEarlyAccessPage = lazyRoute(() => import('./pages/RegistrationEarlyAccessPage'));
const PublicWaitlistOfferDeclinePage = lazyRoute(() => import('./pages/PublicWaitlistOfferDeclinePage'));
const RegistrationStatusDetailPage = lazyRoute(() => import('./pages/RegistrationStatusDetailPage'));
const WaitlistOfferAcceptPage = lazyRoute(() => import('./pages/WaitlistOfferAcceptPage'));
const SabbaticalsExplainerPage = lazyRoute(() => import('./pages/explainers/SabbaticalsExplainerPage'));
const WaitlistsExplainerPage = lazyRoute(() => import('./pages/explainers/WaitlistsExplainerPage'));
const SparingExplainerPage = lazyRoute(() => import('./pages/explainers/SparingExplainerPage'));

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
  if (tab === 'seasons' || tab === 'sessions' || tab === 'periods' || tab === 'prices' || tab === 'discounts') {
    return <Navigate to={`/admin/registrations/settings/${tab}`} replace />;
  }
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

/** Logged-in members should use the member calendar; pair with ProtectedRoute's public fallback. */
function PublicCalendarRoute() {
  const { member, token, isLoading, isLikelyAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading || (isLikelyAuthenticated && !member)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (token && member) {
    return <Navigate to={`/calendar${location.search}${location.hash}`} replace />;
  }

  return <Calendar publicMode />;
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
                      <Route path="/registration/start/early" element={<RegistrationEarlyAccessPage />} />
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

                      <Route path="/calendar/public" element={<PublicCalendarRoute />} />
                      <Route
                        path="/volunteering/public/programs/:slug"
                        element={<PublicVolunteerProgramPage />}
                      />
                      <Route
                        path="/volunteering/public/signups/manage/:accessToken"
                        element={<PublicVolunteerSignupManagePage />}
                      />

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
                        path="/volunteering/programs/:slug"
                        element={
                          <ProtectedRoute>
                            <VolunteerProgramPage />
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
                        path="/building-access"
                        element={
                          <ProtectedRoute>
                            <BuildingAccessPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/member-communications"
                        element={
                          <ProtectedRoute>
                            <MemberCommunicationsPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/board-meeting-minutes"
                        element={
                          <ProtectedRoute>
                            <BoardMeetingMinutesPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/members-area/:navLabel/:articleSlug"
                        element={
                          <ProtectedRoute>
                            <MemberArticlePage />
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
                      <Route path="/admin/sheets" element={<Navigate to="/admin/facility" replace />} />
                      <Route
                        path="/admin/facility"
                        element={
                          <ProtectedRoute leagueManagerOnly>
                            <AdminFacilityInfo />
                          </ProtectedRoute>
                        }
                      >
                        <Route index element={<AdminSheets />} />
                        <Route path="building-access" element={<AdminBuildingAccess />} />
                      </Route>
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
                        path="/admin/service-accounts"
                        element={
                          <ProtectedRoute serverAdminOnly>
                            <AdminServiceAccounts />
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
                        element={<Navigate to="/admin/registrations" replace />}
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
                      <Route path="/admin/registrations/:segment/:subsegment" element={<AdminRegistrationRoute />} />
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
