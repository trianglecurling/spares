import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
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
  volunteerProgramAppearsInDiscovery,
  volunteerProgramHasOpenShifts,
  type VolunteerHubCredential,
  type VolunteerProgramView,
} from '../utils/volunteering';
import { MyVolunteerShiftsPanel } from './MyVolunteerShifts';

type HubTab = 'programs' | 'shifts' | 'credentials';

function resolveHubTab(tabParam: string | null): HubTab {
  if (tabParam === 'credentials') return 'credentials';
  if (tabParam === 'shifts' || tabParam === 'my-shifts') return 'shifts';
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
      const firstWithShifts = nextPrograms.find((p) => p.shifts.some((s) => s.roles.length > 0));
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

  const visiblePrograms = useMemo(
    () => programs.filter(volunteerProgramAppearsInDiscovery),
    [programs]
  );
  const hasAnyOpenShifts = useMemo(
    () => visiblePrograms.some(volunteerProgramHasOpenShifts),
    [visiblePrograms]
  );

  const hasHeldCredentials = useMemo(
    () => credentials.some((credential) => credential.held),
    [credentials]
  );

  useEffect(() => {
    if (loading || activeTab !== 'credentials' || hasHeldCredentials) return;
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [loading, activeTab, hasHeldCredentials, searchParams, setSearchParams]);

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
          ...(hasHeldCredentials
            ? [
                {
                  key: 'credentials',
                  label: 'My credentials',
                  isActive: activeTab === 'credentials',
                  onClick: () => setTab('credentials'),
                },
              ]
            : []),
        ]}
      />

      {activeTab === 'shifts' ? (
        <MyVolunteerShiftsPanel />
      ) : loading ? (
        <AppStateCard title="Loading opportunities" description="Fetching volunteer programs and shifts." />
      ) : activeTab === 'credentials' && hasHeldCredentials ? (
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

              <div className="space-y-3">
                {visiblePrograms.map((program) => {
                  const hasShifts = volunteerProgramHasOpenShifts(program);
                  if (!hasShifts) {
                    return (
                      <div key={program.id} className="app-card space-y-3 p-5">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{program.title}</div>
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
                      <button
                        type="button"
                        onClick={() => setExpandedPrograms((prev) => toggleInSet(prev, program.id))}
                        className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        aria-expanded={expanded}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{program.title}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            {formatProgramShiftDateSpan(program.shifts)}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                            {program.location ? <span>{program.location}</span> : null}
                            <span>Contact: {program.pointOfContact}</span>
                          </div>
                        </div>
                        <HiChevronDown
                          className={`mt-1 h-5 w-5 shrink-0 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {expanded ? (
                        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 space-y-4">
                          {program.description ? (
                            <ArticleMarkdown markdown={program.description} />
                          ) : null}
                          <VolunteerProgramShiftsBody
                            program={program}
                            groupBy={groupBy}
                            onChanged={load}
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
        description="The club has not set up any volunteering credentials yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Need a credential? Reach out to the point of contact listed.
      </p>
      <ul className="space-y-3">
        {credentials.map((cred) => (
          <li key={cred.id} className="app-card p-4 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="font-medium text-gray-900 dark:text-gray-100">{cred.name}</div>
              <span
                className={
                  cred.held
                    ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                    : 'inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                }
              >
                {cred.held ? 'You have this' : 'Not held'}
              </span>
            </div>
            {cred.description ? (
              <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{cred.description}</p>
            ) : null}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Point of contact:{' '}
              <a className="text-primary-teal-link hover:underline" href={`mailto:${cred.pointOfContactEmail}`}>
                {cred.pointOfContactEmail}
              </a>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
