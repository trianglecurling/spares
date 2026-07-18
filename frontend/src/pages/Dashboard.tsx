import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  HiChevronDown,
  HiChevronRight,
  HiOutlineUserPlus,
  HiOutlineCalendar,
  HiOutlineCalendarDays,
  HiOutlineInbox,
  HiOutlineMegaphone,
  HiOutlineInformationCircle,
  HiOutlineExclamationTriangle,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
} from 'react-icons/hi2';
import axios from 'axios';
import { AppPage, AppPageHeader } from '../components/AppPage';
import { get, post } from '../api/client';
import api from '../utils/api';
import { formatApiError } from '../utils/api';
import InlineStateMessage from '../components/InlineStateMessage';
import Modal from '../components/Modal';
import Button from '../components/Button';
import AppStateCard from '../components/AppStateCard';
import DashboardRegistrationStatus from '../components/DashboardRegistrationStatus';
import DashboardMembershipCard from '../components/DashboardMembershipCard';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { memberCanAccessEventsAdmin } from '../utils/eventManagementAccess';
import { isBonspielCalendarType } from '../utils/eventCalendarTypes';
import { isArchivedAt } from '../utils/softDelete';
import { formatPhone } from '../utils/phone';
import { renderMe } from '../utils/me';
import {
  formatVolunteerRange,
  type DashboardVolunteerOpportunity,
} from '../utils/volunteering';

interface SpareRequest {
  id: number;
  requesterName: string;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  leagueName?: string | null;
  position?: string | null;
  message?: string | null;
  requestType: string;
  inviteStatus?: 'pending' | 'declined' | string;
  createdAt: string;
  filledByName?: string | null;
  status?: string;
  filledAt?: string | null;
}

interface MySpareRequest {
  id: number;
  requestedForName: string;
  requestedForMemberId?: number | null;
  requesterId?: number | null;
  requesterName?: string | null;
  gameDate: string;
  gameTime: string;
  leagueName?: string | null;
  position?: string | null;
  message?: string | null;
  requestType: string;
  status: string;
  filledByName?: string | null;
  filledByEmail?: string | null;
  filledByPhone?: string | null;
  filledAt?: string | null;
  sparerComment?: string | null;
}

interface UpcomingGame {
  id: number;
  leagueId: number;
  leagueName: string;
  gameDate: string | null;
  gameTime: string | null;
  sheetName: string | null;
  opponentName: string | null;
  opponentTeamId: number | null;
}

interface MyIceBooking {
  id: number;
  sheetId: number;
  sheetName: string;
  start: string;
  end: string;
  purpose: string;
  purposeOther?: string;
  guestNames?: string;
  createdAt: string;
}

const icePurposeLabel = (purpose: string, other?: string, guestNames?: string) => {
  const map: Record<string, string> = {
    practice: 'Practice',
    makeup_game: 'Make-up game',
    guests: 'Bringing guests',
    guests_new: 'Bringing guests: new curlers',
    guests_experienced: 'Bringing guests: experienced',
    other: 'Other',
  };
  const base = map[purpose] ?? purpose;
  if (purpose === 'other' && other) return `${base}: ${other}`;
  if ((purpose === 'guests_new' || purpose === 'guests_experienced') && guestNames) {
    return `${base} (${guestNames})`;
  }
  return base;
};

const roleLabels: Record<string, string> = {
  lead: 'Lead',
  second: 'Second',
  third: 'Third',
  fourth: 'Fourth',
  player1: 'Player 1',
  player2: 'Player 2',
};

function DashboardSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="app-section-title">{title}</h2>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openRequests, setOpenRequests] = useState<SpareRequest[]>([]);
  const [mySparing, setMySparing] = useState<SpareRequest[]>([]);
  const [filledRequests, setFilledRequests] = useState<SpareRequest[]>([]);
  const [ccRequests, setCcRequests] = useState<SpareRequest[]>([]);
  const [myRequests, setMyRequests] = useState<MySpareRequest[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<UpcomingGame[]>([]);
  const [iceBookings, setIceBookings] = useState<MyIceBooking[]>([]);
  const [volunteerOpportunities, setVolunteerOpportunities] = useState<DashboardVolunteerOpportunity[]>([]);
  const [scorekeeperEvents, setScorekeeperEvents] = useState<
    Array<{ id: number; title: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [showFilled, setShowFilled] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<SpareRequest | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [declineRequest, setDeclineRequest] = useState<SpareRequest | null>(null);
  const [declineComment, setDeclineComment] = useState('');
  const [declining, setDeclining] = useState(false);
  const [cancelRequest, setCancelRequest] = useState<SpareRequest | null>(null);
  const [cancelComment, setCancelComment] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [dashboardAlert, setDashboardAlert] = useState<{
    title?: string;
    body?: string;
    variant?: string;
    icon?: string;
  } | null>(null);
  const [opponentRosterModal, setOpponentRosterModal] = useState<{
    teamId: number;
    teamName: string;
  } | null>(null);
  const [opponentRoster, setOpponentRoster] = useState<
    Array<{ memberId: number; name: string; role: string; isSkip: boolean; isVice: boolean }>
  >([]);
  const [opponentRosterLoading, setOpponentRosterLoading] = useState(false);

  const dashboardAlertStyles = (variant?: string) => {
    switch (variant) {
      case 'success':
        return {
          container: 'border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30',
          text: 'text-emerald-900 dark:text-emerald-100',
        };
      case 'danger':
        return {
          container: 'border-l-4 border-rose-500 bg-rose-50 dark:bg-rose-900/30',
          text: 'text-rose-900 dark:text-rose-100',
        };
      case 'warning':
        return {
          container: 'border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/30',
          text: 'text-amber-900 dark:text-amber-100',
        };
      default:
        return {
          container: 'border-l-4 border-sky-500 bg-sky-50 dark:bg-sky-900/30',
          text: 'text-sky-900 dark:text-sky-100',
        };
    }
  };

  const renderDashboardAlertIcon = (icon?: string, className?: string) => {
    const sharedProps = { className: `${className ?? ''} h-6 w-6` };
    switch (icon) {
      case 'none':
        return null;
      case 'info':
        return <HiOutlineInformationCircle {...sharedProps} />;
      case 'warning':
        return <HiOutlineExclamationTriangle {...sharedProps} />;
      case 'success':
        return <HiOutlineCheckCircle {...sharedProps} />;
      case 'error':
        return <HiOutlineXCircle {...sharedProps} />;
      case 'announcement':
      default:
        return <HiOutlineMegaphone {...sharedProps} />;
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    const loadDashboardAlert = async () => {
      try {
        const response = await get('/public-config');
        const title = response?.dashboardAlertTitle || '';
        const body = response?.dashboardAlertBody || '';
        const variant = response?.dashboardAlertVariant || 'info';
        const icon = response?.dashboardAlertIcon || 'announcement';
        const expiresAtRaw = response?.dashboardAlertExpiresAt || null;
        const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
        const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() : false;
        if ((title.trim() || body.trim()) && !isExpired) {
          setDashboardAlert({ title: title.trim(), body: body.trim(), variant, icon });
        } else {
          setDashboardAlert(null);
        }
      } catch (error) {
        console.error('Failed to load dashboard alert:', error);
      }
    };

    loadDashboardAlert();
  }, []);

  useEffect(() => {
    if (!opponentRosterModal) return;
    setOpponentRosterLoading(true);
    setOpponentRoster([]);
    get('/teams/{teamId}/roster', undefined, { teamId: String(opponentRosterModal.teamId) })
      .then((roster) =>
        setOpponentRoster(
          roster as Array<{
            memberId: number;
            name: string;
            role: string;
            isSkip: boolean;
            isVice: boolean;
          }>
        )
      )
      .catch(() => setOpponentRoster([]))
      .finally(() => setOpponentRosterLoading(false));
  }, [opponentRosterModal]);

  // Check for requestId in URL and open dialog when data is loaded
  useEffect(() => {
    const requestIdParam = searchParams.get('requestId');
    if (requestIdParam && !loading) {
      const requestId = parseInt(requestIdParam, 10);

      // Check if user has already responded to this request
      const alreadyResponded = mySparing.some((r) => r.id === requestId);
      if (alreadyResponded) {
        showAlert('You are already signed up for this spare request.', 'error');
        // Clear the requestId from URL
        searchParams.delete('requestId');
        setSearchParams(searchParams, { replace: true });
        return;
      }

      // Find the request in open requests
      const request = openRequests.find((r) => r.id === requestId);
      if (request) {
        setSelectedRequest(request);
        // Clear the requestId from URL
        searchParams.delete('requestId');
        setSearchParams(searchParams, { replace: true });
      } else {
        // If the request isn't in the open list, it was likely filled/canceled/deleted already.
        // Ask the backend for the status so we can show a specific message.
        (async () => {
          try {
            const res = await get('/spares/{id}/status', undefined, { id: String(requestId) });
            const status = res?.status || 'unknown';

            const message =
              status === 'filled'
                ? 'Sorry, this spare request has already been filled. See your dashboard for any unfilled spare requests.'
                : 'Sorry, this spare request has been deleted and is no longer available. See your dashboard for any unfilled spare requests.';

            showAlert(message, 'error');
          } catch (error: unknown) {
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            // 404 -> deleted; 403 -> not available to this user (treat as deleted for UX)
            if (status === 404 || status === 403) {
              showAlert(
                'Sorry, this spare request has been deleted and is no longer available. See your dashboard for any unfilled spare requests.',
                'error'
              );
            } else {
              showAlert(
                'Sorry, we could not load that spare request. See your dashboard for any unfilled spare requests.',
                'error'
              );
            }
          } finally {
            searchParams.delete('requestId');
            setSearchParams(searchParams, { replace: true });
          }
        })();
      }
    }
  }, [loading, openRequests, mySparing, searchParams, setSearchParams, showAlert]);

  // Check for declineRequestId in URL and open decline dialog when data is loaded
  useEffect(() => {
    const declineIdParam = searchParams.get('declineRequestId');
    if (declineIdParam && !loading) {
      const requestId = parseInt(declineIdParam, 10);
      const request = openRequests.find((r) => r.id === requestId);
      if (request) {
        if (request.requestType !== 'private') {
          showAlert('Decline is only available for private spare requests.', 'error');
        } else {
          setDeclineRequest(request);
        }
      } else {
        showAlert('Spare request not found (it may no longer be available).', 'error');
      }
      searchParams.delete('declineRequestId');
      setSearchParams(searchParams, { replace: true });
    }
  }, [loading, openRequests, searchParams, setSearchParams, showAlert]);

  const loadAllData = async () => {
    try {
      const icePromise =
        member?.socialMember === true
          ? Promise.resolve([] as MyIceBooking[])
          : api.get<MyIceBooking[]>('/ice-bookings').then((r) => r.data ?? []);

      const [
        openRes,
        mySparingRes,
        filledRes,
        ccRes,
        myRequestsRes,
        upcomingGamesRes,
        iceRes,
        volunteerRes,
      ] = await Promise.all([
          get('/spares'),
          get('/spares/my-sparing'),
          get('/spares/filled-upcoming'),
          get('/spares/cc'),
          get('/spares/my-requests'),
          get('/members/me/upcoming-games').catch(() => []),
          icePromise.catch(() => [] as MyIceBooking[]),
          get('/volunteering/dashboard-opportunities').catch(() => ({ opportunities: [] })),
        ]);
      setOpenRequests(openRes);
      setMySparing(mySparingRes);
      setFilledRequests(filledRes);
      setCcRequests(ccRes || []);
      // Filter out canceled requests - only show open and filled
      setMyRequests(myRequestsRes.filter((r: MySpareRequest) => r.status !== 'cancelled'));
      setUpcomingGames(upcomingGamesRes || []);
      setIceBookings(iceRes);
      setVolunteerOpportunities(
        (volunteerRes as { opportunities?: DashboardVolunteerOpportunity[] })?.opportunities || []
      );
    } catch (error) {
      console.error('Failed to load spare requests:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!memberCanAccessEventsAdmin(member)) {
      setScorekeeperEvents([]);
      return;
    }
    let cancelled = false;
    api
      .get<
        Array<{
          id: number;
          title: string;
          calendarTypeIds?: string[] | null;
          tournamentFormat?: 'fours' | 'doubles' | null;
          hasTournamentDraw?: boolean;
          archivedAt?: string | null;
          timespans?: Array<{ start_dt: string; end_dt: string }>;
        }>
      >('/events', { params: { manageable: '1' } })
      .then((res) => {
        if (cancelled) return;
        const now = Date.now();
        const rows = (res.data ?? []).filter((event) => {
          if (isArchivedAt(event.archivedAt)) return false;
          if (!isBonspielCalendarType(event.calendarTypeIds)) return false;
          if (!event.hasTournamentDraw) return false;
          const spans = event.timespans ?? [];
          if (spans.length === 0) return true;
          let latestEnd = 0;
          for (const span of spans) {
            const end = new Date(span.end_dt).getTime();
            if (Number.isFinite(end) && end > latestEnd) latestEnd = end;
          }
          return latestEnd === 0 || latestEnd >= now;
        });
        setScorekeeperEvents(rows.map((e) => ({ id: e.id, title: e.title })));
      })
      .catch(() => {
        if (!cancelled) setScorekeeperEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [member]);

  const handleDeleteIceBooking = async (id: number) => {
    const go = await confirm({
      title: 'Cancel this ice booking?',
      message: 'The sheet will be freed for that time. You can book another slot if you need to.',
      confirmText: 'Cancel booking',
      cancelText: 'Keep booking',
      variant: 'danger',
    });
    if (!go) return;
    try {
      await api.delete(`/ice-bookings/${id}`);
      showAlert('Your ice booking was canceled.', 'success');
      await loadAllData();
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Could not cancel booking'), 'error');
    }
  };

  const handleRespond = async () => {
    if (!selectedRequest) return;

    const mustProvideComment =
      selectedRequest.requestType === 'private' && selectedRequest.inviteStatus === 'declined';
    if (mustProvideComment && !comment.trim()) {
      showAlert(
        'Please include a message when accepting after previously declining this private request.',
        'warning'
      );
      return;
    }

    setSubmitting(true);
    try {
      await post(
        '/spares/{id}/respond',
        { comment: comment.trim() || undefined },
        { id: String(selectedRequest.id) }
      );

      // Reload all data
      await loadAllData();
      setSelectedRequest(null);
      setComment('');

      showAlert(`You've successfully signed up to spare for ${selectedRequest.requestedForName}!`, 'success');
    } catch (error: unknown) {
      console.error('Failed to respond to spare request:', error);

      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const data = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)
        : undefined;

      // Check for specific error cases
      if (status === 404) {
        showAlert('This spare request has been deleted and is no longer available.', 'error');
        // Reload data to remove the deleted request from the list
        await loadAllData();
        setSelectedRequest(null);
        setComment('');
      } else if (status === 400) {
        const errorMessage = data?.error || 'This spare request is no longer open.';
        showAlert(errorMessage, 'error');
        // Reload data to update the request status
        await loadAllData();
        setSelectedRequest(null);
        setComment('');
      } else {
        showAlert(formatApiError(error, 'Failed to respond'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSparing = async () => {
    if (!cancelRequest) return;

    if (!cancelComment.trim()) {
      showAlert('Please provide a comment explaining why you are canceling.', 'warning');
      return;
    }

    setCanceling(true);
    try {
      await post(
        '/spares/{id}/cancel-sparing',
        { comment: cancelComment },
        { id: String(cancelRequest.id) }
      );

      // Reload all data
      await loadAllData();
      setCancelRequest(null);
      setCancelComment('');

      showAlert(`You've successfully canceled sparing for ${cancelRequest.requestedForName}.`, 'success');
    } catch (error) {
      console.error('Failed to cancel sparing:', error);
      showAlert(formatApiError(error, 'Failed to cancel sparing'), 'error');
    } finally {
      setCanceling(false);
    }
  };

  const handleDecline = async () => {
    if (!declineRequest) return;
    if (declineRequest.requestType !== 'private') {
      showAlert('Decline is only available for private spare requests.', 'error');
      return;
    }

    setDeclining(true);
    try {
      await post(
        '/spares/{id}/decline',
        { comment: declineComment.trim() || undefined },
        { id: String(declineRequest.id) }
      );

      await loadAllData();
      setDeclineRequest(null);
      setDeclineComment('');
      showAlert(`You declined the private spare request for ${declineRequest.requestedForName}.`, 'success');
    } catch (error: unknown) {
      console.error('Failed to decline spare request:', error);
      showAlert(formatApiError(error, 'Failed to decline'), 'error');
    } finally {
      setDeclining(false);
    }
  };

  // Note: canceling / managing spare requests is handled on the My Requests page (/my-requests).

  const formatDate = (dateStr: string) => {
    // Parse date string as local date to avoid timezone issues
    // dateStr is in YYYY-MM-DD format from the database
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDayOfWeek = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  };

  const upcomingIceBookings = useMemo(
    () => iceBookings.filter((b) => new Date(b.end).getTime() > Date.now()),
    [iceBookings]
  );

  const filledBadge = (
    <span className="px-2 py-1 rounded text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
      Filled
    </span>
  );

  const statusBadge = (status?: string) => {
    if (status === 'filled') return filledBadge;
    if (status === 'cancelled') {
      return (
        <span className="px-2 py-1 rounded text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          Canceled
        </span>
      );
    }
    return (
      <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-sm font-medium">
        Open
      </span>
    );
  };

  const requestTypeBadge = (requestType?: string) => {
    if (requestType === 'private') {
      return (
        <span className="px-2 py-1 rounded text-sm font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200">
          Private
        </span>
      );
    }
    if (requestType === 'public') {
      return (
        <span className="px-2 py-1 rounded text-sm font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200">
          Public
        </span>
      );
    }
    return null;
  };

  const renderRequestCard = (
    request: SpareRequest,
    showButton = true,
    showMessage = true,
    showCancelButton = false
  ) => {
    const isPrivateInviteDeclined =
      request.requestType === 'private' && request.inviteStatus === 'declined';

    return (
      <div key={request.id} className="app-card p-6">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Spare needed for {renderMe(request.requestedForName, member?.name)}
              </h3>
              {showButton && (
                <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-sm font-medium">
                  Open
                </span>
              )}
              {requestTypeBadge(request.requestType)}
              {request.position && (
                <span className="bg-primary-teal-solid text-white px-2 py-1 rounded text-sm">
                  {request.position}
                </span>
              )}
            </div>

            <div className="text-gray-600 dark:text-gray-400 space-y-1">
              <p>
                <span className="font-medium dark:text-gray-300">When:</span>{' '}
                {formatDate(request.gameDate)} at {formatTime(request.gameTime)}
                {request.leagueName ? <span> • {request.leagueName}</span> : null}
              </p>
              <p>
                <span className="font-medium dark:text-gray-300">Requested by:</span>{' '}
                {renderMe(request.requesterName, member?.name)}
              </p>
              {request.requesterEmail && (
                <p className="text-sm ml-4">
                  <a
                    href={`mailto:${request.requesterEmail}`}
                    className="text-primary-teal hover:underline"
                  >
                    {request.requesterEmail}
                  </a>
                </p>
              )}
              {request.requesterPhone && (
                <p className="text-sm ml-4">
                  <a
                    href={`tel:${request.requesterPhone.replace(/\D/g, '')}`}
                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                  >
                    {formatPhone(request.requesterPhone)}
                  </a>
                </p>
              )}
              {request.filledByName && (
                <p>
                  <span className="font-medium dark:text-gray-300">Filled by:</span>{' '}
                  {renderMe(request.filledByName, member?.name)}
                </p>
              )}
              {showMessage && request.message && <p className="italic mt-2">&quot;{request.message}&quot;</p>}
            </div>
          </div>

          <div className="flex flex-row flex-wrap gap-2 ml-4 justify-end">
            {showButton && request.requestType === 'private' && isPrivateInviteDeclined && (
              <span className="px-3 py-2 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                Declined
              </span>
            )}
            {showButton && (
              <Button onClick={() => setSelectedRequest(request)}>
                {isPrivateInviteDeclined ? 'Sign Up Anyway' : 'Sign Up'}
              </Button>
            )}
            {showButton && request.requestType === 'private' && !isPrivateInviteDeclined && (
              <Button
                variant="secondary"
                onClick={() => {
                  setDeclineRequest(request);
                  setDeclineComment('');
                }}
              >
                Decline
              </Button>
            )}
            {showCancelButton && (
              <Button variant="danger" onClick={() => setCancelRequest(request)}>
                Cancel sparing
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <AppPage>
        <AppPageHeader
          title="Dashboard"
          description={
            member?.name ? `Welcome back, ${member.name.split(' ')[0]}.` : undefined
          }
        />

        {dashboardAlert &&
          (() => {
            const styles = dashboardAlertStyles(dashboardAlert.variant);
            return (
              <div className={`${styles.container} rounded-lg p-4 shadow-sm`}>
                <div className="flex items-start gap-3">
                  {dashboardAlert.icon !== 'none' && (
                    <div className={`${styles.text} mt-0.5`}>
                      {renderDashboardAlertIcon(dashboardAlert.icon, styles.text)}
                    </div>
                  )}
                  <div>
                    {dashboardAlert.title && (
                      <div className={`text-lg font-semibold ${styles.text}`}>
                        {dashboardAlert.title}
                      </div>
                    )}
                    {dashboardAlert.body && (
                      <div className={`text-sm whitespace-pre-line mt-1 ${styles.text}`}>
                        {dashboardAlert.body}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

        {!loading && scorekeeperEvents.length > 0 ? (
          <DashboardSection title="Enter results">
            <div className="space-y-2">
              {scorekeeperEvents.map((event) => (
                <Link
                  key={event.id}
                  to={`/admin/events/${event.id}/scorekeeper`}
                  className="group flex items-center gap-3 rounded-lg border border-gray-200 px-3.5 py-2.5 transition-colors hover:border-primary-teal/40 hover:bg-primary-teal/5 dark:border-gray-700 dark:hover:border-primary-teal/40 dark:hover:bg-primary-teal/10"
                >
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    Enter results: {event.title}
                  </span>
                  <HiChevronRight
                    className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-teal"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          </DashboardSection>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
          <DashboardMembershipCard />

          {!member?.socialMember ? (
            <div className="app-card flex flex-col">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-teal/80 dark:text-primary-teal">
                Quick actions
              </p>
              <div className="mt-4 flex flex-1 flex-col justify-center gap-2.5">
                {!member?.spareOnly && (
                  <Link
                    to="/request-spare"
                    className="group flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 transition-colors hover:border-primary-orange/40 hover:bg-primary-orange/5 dark:hover:border-primary-orange/40 dark:hover:bg-primary-orange/10"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-orange/10 text-primary-orange dark:bg-primary-orange/20">
                      <HiOutlineUserPlus className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      Request a spare
                    </span>
                    <HiChevronRight
                      className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-orange"
                      aria-hidden="true"
                    />
                  </Link>
                )}

                <Link
                  to="/availability"
                  className="group flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 transition-colors hover:border-primary-teal/40 hover:bg-primary-teal/5 dark:hover:border-primary-teal/40 dark:hover:bg-primary-teal/10"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-teal/10 text-primary-teal dark:bg-primary-teal/20">
                    <HiOutlineCalendar className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    Set availability
                  </span>
                  <HiChevronRight
                    className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-teal"
                    aria-hidden="true"
                  />
                </Link>

                <Link
                  to="/book-ice"
                  className="group flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 transition-colors hover:border-primary-dark/30 hover:bg-primary-dark/[0.04] dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-dark/[0.08] text-primary-dark dark:bg-indigo-500/15 dark:text-indigo-300">
                    <HiOutlineCalendarDays className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    Book ice time
                  </span>
                  <HiChevronRight
                    className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-dark dark:group-hover:text-indigo-300"
                    aria-hidden="true"
                  />
                </Link>
              </div>
            </div>
          ) : null}
        </div>

        <DashboardRegistrationStatus />

        {loading ? (
          <AppStateCard title="Loading dashboard..." />
        ) : (
          <div className="space-y-8">
            {/* My ice bookings */}
            {!member?.socialMember && upcomingIceBookings.length > 0 && (
              <DashboardSection
                title="My ice bookings"
                action={
                  <Link
                    to="/book-ice"
                    className="text-sm font-medium text-primary-teal hover:underline"
                  >
                    Book ice time →
                  </Link>
                }
              >
                <div className="space-y-3">
                  {upcomingIceBookings.map((b) => (
                    <div
                      key={b.id}
                      className="app-card p-4 flex flex-wrap items-center gap-3 justify-between"
                    >
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-900 dark:text-gray-100">
                        <span className="font-medium">
                          {new Date(b.start).toLocaleString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400">
                          →{' '}
                          {new Date(b.end).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400">Sheet {b.sheetName}</span>
                        <span className="text-gray-600 dark:text-gray-400 text-sm">
                          {icePurposeLabel(b.purpose, b.purposeOther, b.guestNames)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteIceBooking(b.id)}
                        className="text-sm text-rose-600 dark:text-rose-400 hover:underline font-medium"
                      >
                        Cancel booking
                      </button>
                    </div>
                  ))}
                </div>
              </DashboardSection>
            )}

            {upcomingGames.length > 0 && (
              <DashboardSection title="My upcoming games">
                <div className="space-y-3">
                  {upcomingGames.map((game) => (
                    <div
                      key={game.id}
                      className="app-card p-4 flex flex-wrap items-center gap-x-4 gap-y-2"
                    >
                      <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
                        <HiOutlineCalendarDays className="w-5 h-5 text-primary-teal shrinking-0" />
                        <span className="font-medium">
                          {game.gameDate ? formatDayOfWeek(game.gameDate) : '—'}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400">
                          {game.gameTime ? formatTime(game.gameTime) : '—'}
                        </span>
                      </div>
                      <span className="text-gray-600 dark:text-gray-400">
                        Sheet {game.sheetName ?? '—'}
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        vs{' '}
                        {game.opponentTeamId && game.opponentName ? (
                          <button
                            type="button"
                            onClick={() =>
                              setOpponentRosterModal({
                                teamId: game.opponentTeamId!,
                                teamName: game.opponentName!,
                              })
                            }
                            className="text-primary-teal hover:underline font-medium"
                          >
                            {game.opponentName}
                          </button>
                        ) : (
                          (game.opponentName ?? 'TBD')
                        )}
                      </span>
                      <Link
                        to={`/leagues/${game.leagueId}/schedule`}
                        className="text-sm text-primary-teal hover:underline ml-auto"
                      >
                        {game.leagueName}
                      </Link>
                    </div>
                  ))}
                </div>
              </DashboardSection>
            )}

            {volunteerOpportunities.length > 0 && (
              <DashboardSection
                title="Upcoming volunteer opportunities"
                action={
                  <Link to="/volunteering" className="text-sm text-primary-teal hover:underline">
                    View all →
                  </Link>
                }
              >
                <div className="space-y-3">
                  {volunteerOpportunities.map((opp) => (
                    <div
                      key={opp.shiftRoleId}
                      className="app-card p-4 flex flex-wrap items-center gap-x-4 gap-y-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {opp.programTitle} · {opp.roleName}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {formatVolunteerRange(opp.startDt, opp.endDt)}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {opp.volunteersRegistered}/{opp.volunteersNeeded} filled
                          {opp.location ? ` · ${opp.location}` : ''}
                        </div>
                      </div>
                      <Link
                        to="/volunteering"
                        className="text-sm text-primary-teal hover:underline ml-auto"
                      >
                        Sign up
                      </Link>
                    </div>
                  ))}
                </div>
              </DashboardSection>
            )}

            {/* My upcoming sparing */}
            {mySparing.length > 0 && (
              <DashboardSection title="My upcoming sparing">
                <div className="space-y-3">
                  {mySparing.map((request) => renderRequestCard(request, false, true, true))}
                </div>
              </DashboardSection>
            )}

            {/* My spare requests */}
            {myRequests.length > 0 && (
              <DashboardSection
                title="My spare requests"
                action={
                  <Link
                    to="/my-requests"
                    className="text-sm font-medium text-primary-teal hover:underline"
                  >
                    Manage requests →
                  </Link>
                }
              >
                <div className="space-y-3">
                  {myRequests.map((request) => (
                    <div
                      key={request.id}
                      className="app-card p-6"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                              Spare for {renderMe(request.requestedForName, member?.name)}
                            </h3>
                            {request.status === 'open' && (
                              <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-sm font-medium">
                                Unfilled
                              </span>
                            )}
                            {request.status === 'filled' && (
                              <span className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 px-2 py-1 rounded text-sm font-medium">
                                Filled
                              </span>
                            )}
                            {requestTypeBadge(request.requestType)}
                            {request.position && (
                              <span className="bg-primary-teal-solid text-white px-2 py-1 rounded text-sm">
                                {request.position}
                              </span>
                            )}
                          </div>

                          <div className="text-gray-600 dark:text-gray-400 space-y-1">
                            <p>
                              <span className="font-medium dark:text-gray-300">When:</span>{' '}
                              {formatDate(request.gameDate)} at {formatTime(request.gameTime)}
                              {request.leagueName ? <span> • {request.leagueName}</span> : null}
                            </p>
                            {request.requesterId &&
                              request.requesterId !== member?.id &&
                              request.requesterName && (
                                <p>
                                  <span className="font-medium dark:text-gray-300">
                                    Requested by:
                                  </span>{' '}
                                  {renderMe(request.requesterName, member?.name)}
                                </p>
                              )}
                            {request.message && <p className="italic mt-2">&quot;{request.message}&quot;</p>}
                            {request.status === 'filled' && request.filledByName && (
                              <>
                                <p className="text-green-700 dark:text-green-400 font-medium mt-2">
                                  ✓ Filled by {renderMe(request.filledByName, member?.name)}
                                </p>
                                {request.filledByEmail && (
                                  <p className="text-sm ml-4 mt-1">
                                    <a
                                      href={`mailto:${request.filledByEmail}`}
                                      className="text-primary-teal hover:underline"
                                    >
                                      {request.filledByEmail}
                                    </a>
                                  </p>
                                )}
                                {request.filledByPhone && (
                                  <p className="text-sm ml-4 mt-1">
                                    <a
                                      href={`tel:${request.filledByPhone.replace(/\D/g, '')}`}
                                      className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                    >
                                      {formatPhone(request.filledByPhone)}
                                    </a>
                                  </p>
                                )}
                              </>
                            )}
                            {request.status === 'filled' && request.sparerComment && (
                              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                  Message from {renderMe(request.filledByName, member?.name)}:
                                </p>
                                <p className="text-sm text-gray-600 dark:text-gray-400 italic">
                                  &quot;{request.sparerComment}&quot;
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </DashboardSection>
            )}

            {/* Requests I've been CC'd on */}
            {ccRequests.length > 0 && (
              <DashboardSection title="Requests I've been CC'd on">
                <div className="space-y-3">
                  {ccRequests.map((request) => (
                    <div
                      key={request.id}
                      className="app-card p-6"
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2 flex-wrap">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                              Spare for {renderMe(request.requestedForName, member?.name)}
                            </h3>
                            {statusBadge(request.status)}
                            {requestTypeBadge(request.requestType)}
                            {request.position && (
                              <span className="bg-primary-teal-solid text-white px-2 py-1 rounded text-sm">
                                {request.position}
                              </span>
                            )}
                          </div>

                          <div className="text-gray-600 dark:text-gray-400 space-y-1">
                            <p>
                              <span className="font-medium dark:text-gray-300">When:</span>{' '}
                              {formatDate(request.gameDate)} at {formatTime(request.gameTime)}
                              {request.leagueName ? <span> • {request.leagueName}</span> : null}
                            </p>
                            <p>
                              <span className="font-medium dark:text-gray-300">Requested by:</span>{' '}
                              {renderMe(request.requesterName, member?.name)}
                            </p>
                            {request.filledByName && (
                              <p>
                                <span className="font-medium dark:text-gray-300">Filled by:</span>{' '}
                                {renderMe(request.filledByName, member?.name)}
                              </p>
                            )}
                            {request.message ? (
                              <p className="italic mt-2">&quot;{request.message}&quot;</p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </DashboardSection>
            )}

            {/* Outstanding spare requests */}
            <DashboardSection title="Outstanding spare requests">
              {openRequests.length === 0 ? (
                <div className="app-card py-8 text-center">
                  <div className="flex justify-center mb-2">
                    <HiOutlineInbox className="w-12 h-12 text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-gray-600 dark:text-gray-400">
                    No open spare requests at the moment. Check back later!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {openRequests.map((request) => renderRequestCard(request, true))}
                </div>
              )}
            </DashboardSection>

            {/* Filled spare requests */}
            {filledRequests.length > 0 && (
              <section>
                <div className="app-card overflow-hidden p-0">
                  <h2>
                    <button
                      type="button"
                      onClick={() => setShowFilled(!showFilled)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      aria-expanded={showFilled}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="app-section-title">Filled spare requests</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {filledRequests.length}
                        </span>
                      </span>
                      <HiChevronDown
                        className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${
                          showFilled ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </h2>

                  {showFilled && (
                    <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4">
                      <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {filledRequests.map((request) => (
                          <div
                            key={request.id}
                            className="py-3 flex items-start justify-between gap-4"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {formatDate(request.gameDate)} • {formatTime(request.gameTime)}
                                  {request.leagueName ? ` • ${request.leagueName}` : ''}
                                </span>
                                {filledBadge}
                                {requestTypeBadge(request.requestType)}
                                {request.position && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-primary-teal-solid text-white">
                                    {request.position}
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                                Spare for{' '}
                                <span className="font-medium dark:text-gray-300">
                                  {renderMe(request.requestedForName, member?.name)}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Requested by {renderMe(request.requesterName, member?.name)}
                                {request.filledByName
                                  ? ` • Filled by ${renderMe(request.filledByName, member?.name)}`
                                  : ''}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </AppPage>

      <Modal
        isOpen={!!selectedRequest}
        onClose={() => {
          setSelectedRequest(null);
          setComment('');
        }}
        title="Confirm spare"
      >
        {selectedRequest && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              You&apos;re signing up to spare for <strong>{selectedRequest.requestedForName}</strong> on{' '}
              {formatDate(selectedRequest.gameDate)} at {formatTime(selectedRequest.gameTime)}
              {selectedRequest.leagueName ? ` • ${selectedRequest.leagueName}` : ''}.
            </p>

            {selectedRequest.position && (
              <p className="text-gray-700 dark:text-gray-300">
                Position: <strong>{selectedRequest.position}</strong>
              </p>
            )}

            <div>
              <label
                htmlFor="comment"
                className="app-label"
              >
                {selectedRequest.requestType === 'private' &&
                selectedRequest.inviteStatus === 'declined'
                  ? `Message for ${selectedRequest.requesterName} (required)`
                  : `Optional message for ${selectedRequest.requesterName}`}
              </label>
              <textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="app-input"
                rows={3}
                placeholder={
                  selectedRequest.requestType === 'private' &&
                  selectedRequest.inviteStatus === 'declined'
                    ? 'Since you previously declined this request, please explain what changed so the requester isn’t confused...'
                    : 'Add any notes or questions...'
                }
              />
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={handleRespond}
                disabled={
                  submitting ||
                  (selectedRequest.requestType === 'private' &&
                    selectedRequest.inviteStatus === 'declined' &&
                    !comment.trim())
                }
                className="flex-1"
              >
                {submitting ? 'Confirming...' : 'Confirm'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedRequest(null);
                  setComment('');
                }}
                disabled={submitting}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!opponentRosterModal}
        onClose={() => setOpponentRosterModal(null)}
        title={opponentRosterModal ? `${opponentRosterModal.teamName} — Roster` : 'Team roster'}
      >
        {opponentRosterModal && (
          <div className="space-y-4">
            {opponentRosterLoading ? (
              <InlineStateMessage title="Loading roster..." />
            ) : opponentRoster.length === 0 ? (
              <InlineStateMessage title="No roster set." />
            ) : (
              <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                {opponentRoster.map((member) => (
                  <li key={member.memberId}>
                    {member.name} — {roleLabels[member.role] ?? member.role}
                    {member.isSkip ? ' (Skip)' : ''}
                    {member.isVice ? ' (Vice)' : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!declineRequest}
        onClose={() => {
          setDeclineRequest(null);
          setDeclineComment('');
        }}
        title="Decline private spare request"
      >
        {declineRequest && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              You&apos;re declining a private spare request for{' '}
              <strong>{declineRequest.requestedForName}</strong> on{' '}
              {formatDate(declineRequest.gameDate)} at {formatTime(declineRequest.gameTime)}
              {declineRequest.leagueName ? ` • ${declineRequest.leagueName}` : ''}.
            </p>

            <div>
              <label
                htmlFor="declineComment"
                className="app-label"
              >
                Optional message to the requester
              </label>
              <textarea
                id="declineComment"
                value={declineComment}
                onChange={(e) => setDeclineComment(e.target.value)}
                className="app-input"
                rows={3}
                placeholder="If you add a message, it will be emailed to the requester."
              />
            </div>

            <div className="flex space-x-3">
              <Button
                variant="danger"
                onClick={handleDecline}
                disabled={declining}
                className="flex-1"
              >
                {declining ? 'Declining...' : 'Decline'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDeclineRequest(null);
                  setDeclineComment('');
                }}
                disabled={declining}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!cancelRequest}
        onClose={() => {
          setCancelRequest(null);
          setCancelComment('');
        }}
        title="Cancel sparing"
      >
        {cancelRequest && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Are you sure you want to cancel sparing for{' '}
              <strong>{cancelRequest.requestedForName}</strong>? Please include a comment for the
              spare requester.
            </p>

            <div>
              <label
                htmlFor="cancelComment"
                className="app-label"
              >
                Comment <span className="text-red-500">*</span>
              </label>
              <textarea
                id="cancelComment"
                value={cancelComment}
                onChange={(e) => setCancelComment(e.target.value)}
                className="app-input"
                rows={4}
                placeholder="Please explain why you need to cancel..."
                required
              />
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={handleCancelSparing}
                disabled={canceling || !cancelComment.trim()}
                variant="danger"
                className="flex-1"
              >
                {canceling ? 'Canceling...' : 'Confirm cancellation'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setCancelRequest(null);
                  setCancelComment('');
                }}
                disabled={canceling}
                className="flex-1"
              >
                Never mind
              </Button>
            </div>
          </div>
        )}
      </Modal>

    </>
  );
}
