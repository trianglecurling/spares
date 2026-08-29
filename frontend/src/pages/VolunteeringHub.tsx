import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { HiChevronDown } from 'react-icons/hi2';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppPageControlsRow from '../components/AppPageControlsRow';
import AppStateCard from '../components/AppStateCard';
import ChoiceInput from '../components/ChoiceInput';
import FormField from '../components/FormField';
import PageTabs from '../components/PageTabs';
import VolunteerProgramShiftsBody, {
  type VolunteerProgramGroupBy,
} from '../components/volunteering/VolunteerProgramShiftsBody';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import { get } from '../api/client';
import { useAlert } from '../contexts/AlertContext';
import { formatApiError } from '../utils/api';
import {
  formatProgramShiftDateSpan,
  formatVolunteerDateOnly,
  localDateOnly,
  volunteerCredentialIsValidOn,
  volunteerProgramAppearsInDiscovery,
  volunteerProgramHasIneligibleCredentialRoles,
  volunteerProgramShiftsForCaller,
  volunteerProgramVisibleGivenCredentials,
  type VolunteerHubCredential,
  type VolunteerProgramView,
} from '../utils/volunteering';
import { MyVolunteerShiftsPanel } from './MyVolunteerShifts';
import VolunteerStatsPanel from '../components/volunteering/VolunteerStatsPanel';

type HubTab = 'programs' | 'shifts' | 'stats' | 'credentials';

function resolveHubTab(tabParam: string | null): HubTab {
  if (tabParam === 'credentials') return 'credentials';
  if (tabParam === 'shifts' || tabParam === 'my-shifts') return 'shifts';
  if (tabParam === 'stats') return 'stats';
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
  const [expandedPrograms, setExpandedPrograms] = useState<Set<number>>(new Set());
  const [groupBy, setGroupBy] = useState<VolunteerProgramGroupBy>('shift');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await get('/volunteering/programs')) as {
        programs: VolunteerProgramView[];
        credentials?: VolunteerHubCredential[];
      };
      const nextPrograms = data.programs || [];
      setPrograms(nextPrograms);
      setCredentials(data.credentials || []);
      // Expand the first program with shifts so Group by is visible without an extra click.
      const firstWithShifts = nextPrograms.find(
        (p) => volunteerProgramShiftsForCaller(p).length > 0
      );
      setExpandedPrograms((prev) => {
        if (prev.size > 0 || !firstWithShifts) return prev;
        return new Set([firstWithShifts.id]);
      });
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load volunteering opportunities'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    // Always load hub data so credential-tab visibility is known on every tab,
    // including a direct land on My shifts.
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
          volunteerProgramAppearsInDiscovery(program) &&
          volunteerProgramVisibleGivenCredentials(program, heldCredentialIds)
      ),
    [programs, heldCredentialIds]
  );
  const hasAnyOpenShifts = useMemo(
    () => visiblePrograms.some((program) => volunteerProgramShiftsForCaller(program).length > 0),
    [visiblePrograms]
  );

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

  const toggleInSet = <T,>(prev: Set<T>, key: T): Set<T> => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <AppPage>
      <AppPageHeader
        title="Volunteering hub"
        description="Discover and sign up for volunteer opportunities at the club."
      />

      <PageTabs
        items={[
          {
            key: 'programs',
            label: 'Discover opportunities',
            isActive: activeTab === 'programs',
            onClick: () => setTab('programs'),
          },
          {
            key: 'shifts',
            label: 'My shifts',
            isActive: activeTab === 'shifts',
            onClick: () => setTab('shifts'),
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
      ) : activeTab === 'stats' ? (
        <VolunteerStatsPanel />
      ) : loading ? (
        <AppStateCard title="Loading opportunities" description="Fetching volunteer programs and shifts." />
      ) : activeTab === 'credentials' && hasClubCredentials ? (
        <CredentialsTab credentials={credentials} />
      ) : (
        <div className="space-y-4">
          {visiblePrograms.length === 0 ? (
            <AppStateCard
              title="No upcoming opportunities"
              description="There are no volunteer opportunities right now. Check back soon."
            />
          ) : (
            <>
              {hasAnyOpenShifts ? (
                <AppPageControlsRow
                  left={
                    <FormField label="Group by" htmlFor="volunteer-group-by" className="mb-0">
                      <ChoiceInput<VolunteerProgramGroupBy>
                        inputId="volunteer-group-by"
                        listboxLabel="Group by"
                        layout="inline"
                        name="volunteer-group-by"
                        options={[
                          { value: 'shift', label: 'Shift time' },
                          { value: 'role', label: 'Role' },
                        ]}
                        value={groupBy}
                        onChange={(v) => {
                          if (v === 'shift' || v === 'role') setGroupBy(v);
                        }}
                      />
                    </FormField>
                  }
                />
              ) : null}

              <div className="space-y-5">
                {visiblePrograms.map((program) => {
                  const visibleShifts = volunteerProgramShiftsForCaller(program);
                  const hasHiddenCredentialRoles =
                    !program.canManage && volunteerProgramHasIneligibleCredentialRoles(program);
                  const hasShifts = visibleShifts.length > 0 || hasHiddenCredentialRoles;
                  const programHref = `/volunteering/programs/${program.slug}`;
                  const programTitleLinkClass =
                    'relative z-10 rounded-sm font-medium text-gray-900 hover:text-primary-teal-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50 dark:text-gray-100';
                  if (!hasShifts) {
                    return (
                      <div key={program.id} className="app-card space-y-3 p-5">
                        <Link to={programHref} className={programTitleLinkClass}>
                          {program.title}
                        </Link>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                          {program.location ? <span>{program.location}</span> : null}
                          <span>Contact: {program.pointOfContact}</span>
                        </div>
                        {program.description ? (
                          <ArticleMarkdown markdown={program.description} />
                        ) : null}
                      </div>
                    );
                  }

                  const expanded = expandedPrograms.has(program.id);
                  return (
                    <div key={program.id} className="app-card overflow-hidden p-0">
                      <div className="relative px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                        <button
                          type="button"
                          onClick={() => setExpandedPrograms((prev) => toggleInSet(prev, program.id))}
                          className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-teal/50"
                          aria-expanded={expanded}
                          aria-label={
                            expanded
                              ? `Hide shifts for ${program.title}`
                              : `Show shifts for ${program.title}`
                          }
                        />
                        <div className="relative flex items-start justify-between gap-3 pointer-events-none">
                          <div className="min-w-0 space-y-1">
                            <Link
                              to={programHref}
                              className={`${programTitleLinkClass} pointer-events-auto`}
                            >
                              {program.title}
                            </Link>
                            {visibleShifts.length > 0 ? (
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {formatProgramShiftDateSpan(visibleShifts)}
                              </div>
                            ) : null}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                              {program.location ? <span>{program.location}</span> : null}
                              <span>Contact: {program.pointOfContact}</span>
                            </div>
                          </div>
                          <HiChevronDown
                            className={`mt-1 h-5 w-5 shrink-0 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
                            aria-hidden="true"
                          />
                        </div>
                      </div>

                      {expanded ? (
                        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 space-y-4">
                          {program.description ? (
                            <ArticleMarkdown markdown={program.description} />
                          ) : null}
                          <VolunteerProgramShiftsBody
                            program={program}
                            groupBy={groupBy}
                            onChanged={load}
                            heldCredentialIds={heldCredentialIds}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </AppPage>
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
        Need a credential? Reach out to the point of contact listed.
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
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Point of contact:{' '}
                <a className="text-primary-teal-link hover:underline" href={`mailto:${cred.pointOfContactEmail}`}>
                  {cred.pointOfContactEmail}
                </a>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
