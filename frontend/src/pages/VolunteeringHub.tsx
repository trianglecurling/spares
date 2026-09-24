import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { HiCheckCircle, HiChevronRight } from 'react-icons/hi2';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import PageTabs from '../components/PageTabs';
import VolunteerSpotsStatusBadge from '../components/volunteering/VolunteerSpotsStatusBadge';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import { get } from '../api/client';
import { useAlert } from '../contexts/AlertContext';
import { formatApiError } from '../utils/api';
import {
  formatProgramShiftDateSpan,
  formatVolunteerDateOnly,
  localDateOnly,
  volunteerCredentialIsValidOn,
  parseVolunteerSignupKind,
  volunteerProgramAppearsInDiscovery,
  volunteerProgramHasIneligibleCredentialRoles,
  volunteerProgramShiftsForCaller,
  volunteerProgramUiTerms,
  volunteerProgramVisibleGivenCredentials,
  type VolunteerHubCredential,
  type VolunteerProgramUiTerms,
  type VolunteerProgramView,
} from '../utils/volunteering';
import { MyVolunteerShiftsPanel } from './MyVolunteerShifts';
import VolunteerStatsPanel from '../components/volunteering/VolunteerStatsPanel';
import VolunteerHourLogsPanel from '../components/volunteering/VolunteerHourLogsPanel';

type HubTab = 'programs' | 'other' | 'shifts' | 'hours' | 'stats' | 'credentials';

function resolveHubTab(tabParam: string | null): HubTab {
  if (tabParam === 'credentials') return 'credentials';
  if (tabParam === 'shifts' || tabParam === 'my-shifts') return 'shifts';
  if (tabParam === 'hours') return 'hours';
  if (tabParam === 'stats') return 'stats';
  if (tabParam === 'other' || tabParam === 'signups' || tabParam === 'sign-ups') return 'other';
  return 'programs';
}

export default function VolunteeringHub() {
  const { showAlert } = useAlert();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveHubTab(searchParams.get('tab'));
  const programParam = searchParams.get('program');
  const legacyProgramId = (() => {
    if (!programParam) return null;
    const parsed = Number.parseInt(programParam, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })();

  const [loading, setLoading] = useState(true);
  const [programs, setPrograms] = useState<VolunteerProgramView[]>([]);
  const [credentials, setCredentials] = useState<VolunteerHubCredential[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await get('/volunteering/programs')) as {
        programs: VolunteerProgramView[];
        credentials?: VolunteerHubCredential[];
      };
      setPrograms(data.programs || []);
      setCredentials(data.credentials || []);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load sign-up opportunities'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    // Always load hub data so credential-tab visibility is known on every tab,
    // including a direct land on My sign-ups.
    void load();
  }, [load]);

  const heldCredentialIds = useMemo(
    () => new Set(credentials.filter((credential) => credential.held).map((credential) => credential.id)),
    [credentials]
  );
  const visiblePrograms = useMemo(
    () =>
      programs.filter(
        (program) =>
          parseVolunteerSignupKind(program.signupKind) ===
            (activeTab === 'other' ? 'general' : 'volunteering') &&
          volunteerProgramAppearsInDiscovery(program) &&
          volunteerProgramVisibleGivenCredentials(program, heldCredentialIds)
      ),
    [programs, heldCredentialIds, activeTab]
  );
  const terms = volunteerProgramUiTerms(activeTab === 'other' ? 'general' : 'volunteering');

  const hasClubCredentials = credentials.length > 0;

  if (legacyProgramId != null) {
    return <Navigate to={`/volunteering/programs/${legacyProgramId}`} replace />;
  }

  const setTab = (tab: HubTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'programs') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <AppPage>
      <AppPageHeader
        title="Volunteering & sign-ups"
        description="Discover volunteer opportunities and other club sign-ups."
      />

      <PageTabs
        items={[
          {
            key: 'programs',
            label: 'Volunteering',
            isActive: activeTab === 'programs',
            onClick: () => setTab('programs'),
          },
          {
            key: 'other',
            label: 'Other sign-ups',
            isActive: activeTab === 'other',
            onClick: () => setTab('other'),
          },
          {
            key: 'shifts',
            label: 'My sign-ups',
            isActive: activeTab === 'shifts',
            onClick: () => setTab('shifts'),
          },
          {
            key: 'hours',
            label: 'Log volunteering',
            isActive: activeTab === 'hours',
            onClick: () => setTab('hours'),
          },
          ...(hasClubCredentials
            ? [
                {
                  key: 'credentials',
                  label: 'My credentials',
                  isActive: activeTab === 'credentials',
                  onClick: () => setTab('credentials'),
                },
              ]
            : []),
          {
            key: 'stats',
            label: 'Volunteering stats',
            isActive: activeTab === 'stats',
            onClick: () => setTab('stats'),
          },
        ]}
      />

      {activeTab === 'shifts' ? (
        <MyVolunteerShiftsPanel />
      ) : activeTab === 'hours' ? (
        <VolunteerHourLogsPanel />
      ) : activeTab === 'stats' ? (
        <VolunteerStatsPanel />
      ) : loading ? (
        <AppStateCard
          title={activeTab === 'other' ? 'Loading sign-ups' : 'Loading opportunities'}
          description={
            activeTab === 'other' ? 'Fetching programs and times.' : 'Fetching programs and shifts.'
          }
        />
      ) : activeTab === 'credentials' && hasClubCredentials ? (
        <CredentialsTab credentials={credentials} />
      ) : (
        <div className="space-y-4">
          {visiblePrograms.length === 0 ? (
            <AppStateCard
              title={activeTab === 'other' ? 'No upcoming sign-ups' : 'No upcoming opportunities'}
              description={
                activeTab === 'other'
                  ? 'There are no other sign-ups right now. Check back soon.'
                  : 'There are no volunteer opportunities right now. Check back soon.'
              }
            />
          ) : (
            <ul className="space-y-4">
              {visiblePrograms.map((program) => (
                <li key={program.id}>
                  <ProgramSummaryCard program={program} terms={terms} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AppPage>
  );
}

function ProgramSummaryCard({
  program,
  terms,
}: {
  program: VolunteerProgramView;
  terms: VolunteerProgramUiTerms;
}) {
  const programHref = `/volunteering/programs/${program.slug}`;
  const visibleShifts = volunteerProgramShiftsForCaller(program);
  const visibleRoles = visibleShifts.flatMap((shift) => shift.roles);
  const hasHiddenCredentialRoles =
    !program.canManage && volunteerProgramHasIneligibleCredentialRoles(program);
  const hasShifts = visibleShifts.length > 0 || hasHiddenCredentialRoles;
  const roleNames = [...new Set(visibleRoles.map((role) => role.roleName.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );
  const maxRolesShown = 4;
  const rolePreview =
    roleNames.length > maxRolesShown
      ? `${roleNames.slice(0, maxRolesShown).join(' · ')} · +${roleNames.length - maxRolesShown} more`
      : roleNames.join(' · ');
  const callerSignupCount = program.shifts.reduce(
    (count, shift) => count + shift.roles.filter((role) => role.callerIsSignedUp).length,
    0
  );
  const signedUpLabel =
    callerSignupCount === 0
      ? null
      : parseVolunteerSignupKind(program.signupKind) === 'general'
        ? callerSignupCount === 1
          ? "You're signed up"
          : `You have ${callerSignupCount} sign-ups`
        : `You're signed up for ${callerSignupCount} ${callerSignupCount === 1 ? terms.shiftSingular : terms.shiftPlural}`;

  return (
    <article
      className={`app-card relative space-y-2 ${hasShifts ? 'transition-colors hover:border-primary-teal/60 hover:bg-gray-50 dark:hover:bg-gray-800/60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <Link
            to={programHref}
            className={`rounded-sm hover:text-primary-teal-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 ${hasShifts ? 'after:absolute after:inset-0 after:rounded-xl' : ''}`}
          >
            {program.title}
          </Link>
        </h2>
        {hasShifts ? (
          <div className="flex shrink-0 items-center gap-2">
            {visibleRoles.length > 0 ? <VolunteerSpotsStatusBadge roles={visibleRoles} /> : null}
            <HiChevronRight className="h-5 w-5 text-gray-400" aria-hidden="true" />
          </div>
        ) : null}
      </div>
      {visibleShifts.length > 0 ? (
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {formatProgramShiftDateSpan(visibleShifts)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
        {program.location ? <span>{program.location}</span> : null}
        <span>Contact: {program.pointOfContact}</span>
      </div>
      {rolePreview ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-700 dark:text-gray-300">{terms.roleTab}:</span>{' '}
          {rolePreview}
        </p>
      ) : null}
      {hasHiddenCredentialRoles && visibleRoles.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          These {terms.shiftPlural} require credentials you don&apos;t have yet.
        </p>
      ) : null}
      {signedUpLabel ? (
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <HiCheckCircle className="h-4 w-4" aria-hidden="true" />
          {signedUpLabel}
        </p>
      ) : null}
      {!hasShifts && program.description ? <ArticleMarkdown markdown={program.description} /> : null}
    </article>
  );
}

function CredentialsTab({ credentials }: { credentials: VolunteerHubCredential[] }) {
  if (credentials.length === 0) {
    return (
      <AppStateCard
        title="No credentials configured"
        description="The club has not set up any credentials yet."
      />
    );
  }

  const todayKey = localDateOnly();

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Need a credential that is not granted automatically? Reach out to the point of contact listed.
      </p>
      <ul className="space-y-3">
        {credentials.map((cred) => {
          const expired = Boolean(cred.expiresAt) && !volunteerCredentialIsValidOn(cred.expiresAt, todayKey);
          const statusLabel = cred.held ? 'You have this' : expired ? 'Expired' : 'Not held';
          return (
            <li key={cred.id} className="app-card p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-medium text-gray-900 dark:text-gray-100">{cred.name}</div>
                <span
                  className={
                    cred.held
                      ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                      : expired
                        ? 'inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                        : 'inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                  }
                >
                  {statusLabel}
                </span>
              </div>
              {cred.description ? (
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{cred.description}</p>
              ) : null}
              {cred.systemKey ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Granted automatically when you meet this requirement.
                </p>
              ) : null}
              {cred.held && cred.expiresAt ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Expires {formatVolunteerDateOnly(cred.expiresAt)}
                </p>
              ) : null}
              {expired && cred.expiresAt ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Expired {formatVolunteerDateOnly(cred.expiresAt)}
                </p>
              ) : null}
              {cred.systemKey ? null : (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Point of contact:{' '}
                  <a className="text-primary-teal-link hover:underline" href={`mailto:${cred.pointOfContactEmail}`}>
                    {cred.pointOfContactEmail}
                  </a>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
