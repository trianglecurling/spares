import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AppPage, AppPageHeader } from '../components/AppPage';
import { get } from '../api/client';
import { formatPhone } from '../utils/phone';
import AppPageControlsRow from '../components/AppPageControlsRow';
import InlineStateMessage from '../components/InlineStateMessage';
import Modal from '../components/Modal';
import Button from '../components/Button';
import PageTabs from '../components/PageTabs';
import AppStateCard from '../components/AppStateCard';
import DataTable from '../components/table/DataTable';
import type { DataTableColumn } from '../components/table/tableTypes';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';
import FormField from '../components/FormField';
import useTableQueryState from '../hooks/useTableQueryState';
import { useLeagueOptions } from '../contexts/LeagueOptionsContext';
import { isLeagueEligibleForSpares } from '../utils/leagueSpareEligibility';

const MEMBERS_PAGE_SIZE = 50;

const MEMBER_DIRECTORY_TABLE_SORT_KEYS = ['name'] as const;
type MemberDirectoryTableSortKey = (typeof MEMBER_DIRECTORY_TABLE_SORT_KEYS)[number];

interface Member {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  isAdmin: boolean;
  isServerAdmin: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
}

interface MemberAvailability {
  canSkip: boolean;
  availableLeagues: {
    leagueId: number;
    leagueName: string;
    dayOfWeek: number;
  }[];
}

interface MemberLeague {
  leagueId: number;
  leagueName: string;
  dayOfWeek: number;
  teamId: number | null;
  teamName: string | null;
}

interface MemberEmergencyContact {
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

interface MemberExperienceSummary {
  totalExperienceYears: number;
}

type MemberProfileModalTab = 'profile' | 'emergency-contact' | 'sparing' | 'leagues';

type MembersPageTab = 'directory' | 'spare-lists';

function formatExperienceYears(years: number): string {
  const displayValue = Number.isInteger(years) ? String(years) : years.toFixed(1).replace(/\.0$/, '');
  return `${displayValue} ${years === 1 ? 'year' : 'years'}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const roleLabels: Record<string, string> = {
  lead: 'Lead',
  second: 'Second',
  third: 'Third',
  fourth: 'Fourth',
  player1: 'Player 1',
  player2: 'Player 2',
};

export default function MembersDirectory() {
  const membersSearchInputId = useId();
  const spareLeagueInputId = useId();
  const { leagues } = useLeagueOptions();
  const [pageTab, setPageTab] = useState<MembersPageTab>('directory');
  const [members, setMembers] = useState<Member[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [spareLeagueId, setSpareLeagueId] = useState<number | null>(null);
  const [spareMembers, setSpareMembers] = useState<Member[]>([]);
  const [spareLoading, setSpareLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberAvailability, setMemberAvailability] = useState<MemberAvailability | null>(null);
  const [memberLeagues, setMemberLeagues] = useState<MemberLeague[] | null>(null);
  const [memberEmergencyContact, setMemberEmergencyContact] = useState<MemberEmergencyContact | null>(
    null
  );
  const [memberExperience, setMemberExperience] = useState<MemberExperienceSummary | null>(null);
  const [profileModalTab, setProfileModalTab] = useState<MemberProfileModalTab>('profile');
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [loadingEmergencyContact, setLoadingEmergencyContact] = useState(false);
  const [loadingExperience, setLoadingExperience] = useState(false);
  const [teamRosterModal, setTeamRosterModal] = useState<{
    teamId: number;
    teamName: string;
  } | null>(null);
  const [teamRoster, setTeamRoster] = useState<
    Array<{ memberId: number; name: string; role: string; isSkip: boolean; isVice: boolean }>
  >([]);
  const [teamRosterLoading, setTeamRosterLoading] = useState(false);

  const memberFilterConfig = useMemo(
    () => ({
      search: {
        queryKey: 'search',
        defaultValue: '',
        debounceMs: 250,
      },
    }),
    []
  );

  const { page, filters, draftFilters, setPage, setDraftFilter } = useTableQueryState<
    MemberDirectoryTableSortKey,
    { search: string }
  >({
    defaultSort: { key: 'name', direction: 'asc' },
    sortKeys: MEMBER_DIRECTORY_TABLE_SORT_KEYS,
    filterConfig: memberFilterConfig,
  });

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await get('/members/directory', {
        page,
        pageSize: MEMBERS_PAGE_SIZE,
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
      });
      const data = response as { items?: Member[]; total?: number; page?: number };
      setMembers(Array.isArray(data.items) ? data.items : []);
      setTotalMembers(typeof data.total === 'number' ? data.total : 0);
      if (typeof data.page === 'number' && data.page !== page) {
        setPage(data.page, { replace: true });
      }
    } catch (error) {
      console.error('Failed to load members:', error);
      setMembers([]);
      setTotalMembers(0);
    } finally {
      setLoading(false);
    }
  }, [filters.search, page, setPage]);

  useEffect(() => {
    if (pageTab !== 'directory') return;
    void loadMembers();
  }, [loadMembers, pageTab]);

  const loadSpareMembers = useCallback(async (leagueId: number) => {
    setSpareLoading(true);
    try {
      const response = await get('/members/directory', {
        leagueId,
        page: 1,
        pageSize: 100,
      });
      const data = response as { items?: Member[] };
      setSpareMembers(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error('Failed to load spare list:', error);
      setSpareMembers([]);
    } finally {
      setSpareLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pageTab !== 'spare-lists' || spareLeagueId == null) {
      setSpareMembers([]);
      return;
    }
    void loadSpareMembers(spareLeagueId);
  }, [loadSpareMembers, pageTab, spareLeagueId]);

  useEffect(() => {
    if (!teamRosterModal) return;
    setTeamRosterLoading(true);
    setTeamRoster([]);
    get('/teams/{teamId}/roster', undefined, { teamId: String(teamRosterModal.teamId) })
      .then((roster) =>
        setTeamRoster(
          roster as Array<{
            memberId: number;
            name: string;
            role: string;
            isSkip: boolean;
            isVice: boolean;
          }>
        )
      )
      .catch(() => setTeamRoster([]))
      .finally(() => setTeamRosterLoading(false));
  }, [teamRosterModal]);

  const paginationConfig = useMemo(
    () => ({
      page,
      pageSize: MEMBERS_PAGE_SIZE,
      totalRecords: totalMembers,
      currentCount: members.length,
      onPageChange: setPage,
    }),
    [members.length, page, setPage, totalMembers]
  );

  const tableEmptyState = useMemo(() => {
    if (totalMembers === 0 && !filters.search.trim()) {
      return <AppStateCard compact title="No members in the directory." />;
    }
    const q = filters.search.trim();
    return (
      <AppStateCard
        compact
        title={q ? `No members found matching "${q}"` : 'No members match this filter.'}
      />
    );
  }, [filters.search, totalMembers]);

  const spareTableEmptyState = useMemo(() => {
    if (spareLeagueId == null) {
      return <AppStateCard compact title="Select a league to view members available to spare." />;
    }
    return (
      <AppStateCard compact title="No members have marked themselves available to spare for this league." />
    );
  }, [spareLeagueId]);

  const handleMemberClick = useCallback(async (member: Member) => {
    setSelectedMember(member);
    setProfileModalTab('profile');
    setMemberAvailability(null);
    setMemberLeagues(null);
    setMemberEmergencyContact(null);
    setMemberExperience(null);

    setLoadingAvailability(true);
    setLoadingLeagues(true);
    setLoadingEmergencyContact(true);
    setLoadingExperience(true);
    try {
      const memberId = String(member.id);
      const [availabilityRes, leaguesRes, emergencyContactRes, experienceRes] = await Promise.all([
        get('/members/{memberId}/availability', undefined, { memberId }),
        get('/members/{memberId}/leagues', undefined, { memberId }),
        get('/members/{memberId}/emergency-contact', undefined, { memberId }),
        get('/members/{memberId}/experience', undefined, { memberId }),
      ]);
      setMemberAvailability(availabilityRes);
      setMemberLeagues(Array.isArray(leaguesRes) ? leaguesRes : []);
      setMemberEmergencyContact(emergencyContactRes);
      setMemberExperience(experienceRes as MemberExperienceSummary);
    } catch (error) {
      console.error('Failed to load member data:', error);
      setMemberAvailability({ canSkip: false, availableLeagues: [] });
      setMemberLeagues([]);
      setMemberEmergencyContact(null);
      setMemberExperience(null);
    } finally {
      setLoadingAvailability(false);
      setLoadingLeagues(false);
      setLoadingEmergencyContact(false);
      setLoadingExperience(false);
    }
  }, []);

  const handleCloseModal = () => {
    setSelectedMember(null);
    setMemberAvailability(null);
    setMemberLeagues(null);
    setMemberEmergencyContact(null);
    setMemberExperience(null);
    setProfileModalTab('profile');
    setTeamRosterModal(null);
  };

  const leagueOptions = useMemo<ChoiceOption<number>[]>(
    () =>
      leagues
        .filter((l) => isLeagueEligibleForSpares(l))
        .map((l) => ({
          value: l.id,
          label: `${l.name} (${DAY_NAMES[l.dayOfWeek]})`,
        })),
    [leagues]
  );

  const columns: Array<DataTableColumn<Member>> = useMemo(
    () => [
      {
        id: 'name',
        header: 'Name',
        cellClassName: 'whitespace-nowrap',
        renderCell: (member) => (
          <button
            type="button"
            onClick={() => handleMemberClick(member)}
            className="cursor-pointer text-left font-medium text-gray-900 hover:text-primary-teal-link dark:text-gray-100"
          >
            {member.name}
          </button>
        ),
      },
      {
        id: 'email',
        header: 'Email',
        cellClassName: 'whitespace-nowrap',
        renderCell: (member) =>
          member.email ? (
            <a href={`mailto:${member.email}`} className="text-primary-teal-link hover:underline">
              {member.email}
            </a>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">—</span>
          ),
      },
      {
        id: 'phone',
        header: 'Phone',
        cellClassName: 'whitespace-nowrap',
        renderCell: (member) =>
          member.phone ? (
            <a
              href={`tel:${member.phone.replace(/\D/g, '')}`}
              className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {formatPhone(member.phone)}
            </a>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">—</span>
          ),
      },
      {
        id: 'role',
        header: 'Role',
        cellClassName: 'whitespace-nowrap',
        renderCell: (member) =>
          member.isServerAdmin ? (
            <span className="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-200">
              Server admin
            </span>
          ) : member.isAdmin ? (
            <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
              Admin
            </span>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">—</span>
          ),
      },
    ],
    [handleMemberClick]
  );

  return (
    <>
      <AppPage>
        <AppPageHeader title="Member directory" />

        <PageTabs
          items={[
            {
              key: 'directory',
              label: 'Directory',
              isActive: pageTab === 'directory',
              onClick: () => setPageTab('directory'),
            },
            {
              key: 'spare-lists',
              label: 'Spare lists',
              isActive: pageTab === 'spare-lists',
              onClick: () => setPageTab('spare-lists'),
            },
          ]}
        />

        {pageTab === 'directory' ? (
          <>
            <AppPageControlsRow
              right={
                <div className="w-full sm:w-64">
                  <FormField label="Search members by name" htmlFor={membersSearchInputId}>
                    <input
                      id={membersSearchInputId}
                      type="search"
                      placeholder="Search by name"
                      value={draftFilters.search}
                      onChange={(e) => setDraftFilter('search', e.target.value)}
                      className="app-input"
                    />
                  </FormField>
                </div>
              }
            />

            {loading ? (
              <AppStateCard title="Loading members..." />
            ) : (
              <DataTable
                rows={members}
                rowKey={(member) => member.id}
                columns={columns}
                pagination={paginationConfig}
                emptyState={tableEmptyState}
              />
            )}
          </>
        ) : (
          <>
            <AppPageControlsRow
              right={
                <div className="w-full sm:w-72">
                  <FormField label="League" htmlFor={spareLeagueInputId}>
                    <ChoiceInput<number>
                      inputId={spareLeagueInputId}
                      ariaLabel="Select league for spare list"
                      options={leagueOptions}
                      value={spareLeagueId}
                      onChange={(next) => {
                        if (next == null || Array.isArray(next)) {
                          setSpareLeagueId(null);
                          return;
                        }
                        setSpareLeagueId(next);
                      }}
                      placeholder="Select a league"
                      listboxLabel="League spare list"
                    />
                  </FormField>
                </div>
              }
            />

            {spareLoading ? (
              <AppStateCard title="Loading spare list..." />
            ) : (
              <DataTable
                rows={spareLeagueId == null ? [] : spareMembers}
                rowKey={(member) => member.id}
                columns={columns}
                emptyState={spareTableEmptyState}
              />
            )}
          </>
        )}

        <Modal
          isOpen={!!selectedMember}
          onClose={handleCloseModal}
          title={selectedMember ? `${selectedMember.name}'s Profile` : ''}
          size="lg"
        >
          {selectedMember && (
            <div className="flex flex-col min-h-[400px]">
              <PageTabs
                className="mb-4 shrink-0"
                items={[
                  {
                    key: 'profile',
                    label: 'Profile',
                    isActive: profileModalTab === 'profile',
                    onClick: () => setProfileModalTab('profile'),
                  },
                  {
                    key: 'emergency-contact',
                    label: 'Emergency contact',
                    isActive: profileModalTab === 'emergency-contact',
                    onClick: () => setProfileModalTab('emergency-contact'),
                  },
                  {
                    key: 'sparing',
                    label: 'Sparing availability',
                    isActive: profileModalTab === 'sparing',
                    onClick: () => setProfileModalTab('sparing'),
                  },
                  {
                    key: 'leagues',
                    label: 'Leagues',
                    isActive: profileModalTab === 'leagues',
                    onClick: () => setProfileModalTab('leagues'),
                  },
                ]}
              />

              <div className="overflow-y-auto flex-1 min-h-0">
                {profileModalTab === 'profile' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="app-section-title mb-3">Contact information</h3>
                      <div className="space-y-2">
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">Name:</span>{' '}
                        <span className="text-gray-900 dark:text-gray-100">
                          {selectedMember.name}
                        </span>
                      </div>
                      {selectedMember.email && (
                        <div>
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            Email:
                          </span>{' '}
                          <a
                            href={`mailto:${selectedMember.email}`}
                            className="text-primary-teal-link hover:underline"
                          >
                            {selectedMember.email}
                          </a>
                        </div>
                      )}
                      {selectedMember.phone && (
                        <div>
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            Phone:
                          </span>{' '}
                          <a
                            href={`tel:${selectedMember.phone.replace(/\D/g, '')}`}
                            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                          >
                            {formatPhone(selectedMember.phone)}
                          </a>
                        </div>
                      )}
                      {(selectedMember.isAdmin || selectedMember.isServerAdmin) && (
                        <div>
                          {selectedMember.isServerAdmin ? (
                            <span className="px-2 py-1 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 rounded">
                              Server admin
                            </span>
                          ) : (
                            <span className="px-2 py-1 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded">
                              Admin
                            </span>
                          )}
                        </div>
                      )}
                      </div>
                    </div>

                    <div>
                      <h3 className="app-section-title mb-3">Experience</h3>
                      {loadingExperience ? (
                        <InlineStateMessage title="Loading experience..." />
                      ) : memberExperience ? (
                        <div>
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            Years of experience:
                          </span>{' '}
                          <span className="text-gray-900 dark:text-gray-100">
                            {formatExperienceYears(memberExperience.totalExperienceYears)}
                          </span>
                        </div>
                      ) : (
                        <InlineStateMessage title="Unable to load experience." />
                      )}
                    </div>
                  </div>
                )}

                {profileModalTab === 'emergency-contact' && (
                  <div>
                    <h3 className="app-section-title mb-3">Emergency contact</h3>
                    {loadingEmergencyContact ? (
                      <InlineStateMessage title="Loading emergency contact..." />
                    ) : memberEmergencyContact ? (
                      <div className="space-y-2">
                        {memberEmergencyContact.emergencyContactName ||
                        memberEmergencyContact.emergencyContactPhone ? (
                          <>
                            {memberEmergencyContact.emergencyContactName ? (
                              <div>
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                  Name:
                                </span>{' '}
                                <span className="text-gray-900 dark:text-gray-100">
                                  {memberEmergencyContact.emergencyContactName}
                                </span>
                              </div>
                            ) : null}
                            {memberEmergencyContact.emergencyContactPhone ? (
                              <div>
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                  Phone:
                                </span>{' '}
                                <a
                                  href={`tel:${memberEmergencyContact.emergencyContactPhone.replace(/\D/g, '')}`}
                                  className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                                >
                                  {formatPhone(memberEmergencyContact.emergencyContactPhone)}
                                </a>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <InlineStateMessage title="No emergency contact on file." />
                        )}
                      </div>
                    ) : (
                      <InlineStateMessage title="Unable to load emergency contact." />
                    )}
                  </div>
                )}

                {profileModalTab === 'sparing' && (
                  <div>
                    <h3 className="app-section-title mb-3">
                      Sparing Availability
                    </h3>
                    {loadingAvailability ? (
                      <div className="text-gray-500 dark:text-gray-400">
                        Loading availability...
                      </div>
                    ) : memberAvailability ? (
                      <div className="space-y-4">
                        {memberAvailability.availableLeagues.length > 0 ? (
                          <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                              Available for these leagues:
                            </p>
                            <ul className="space-y-2">
                              {memberAvailability.availableLeagues.map((league) => (
                                <li key={league.leagueId} className="flex items-center">
                                  <span className="text-gray-900 dark:text-gray-100">
                                    <strong>{league.leagueName}</strong> (
                                    {DAY_NAMES[league.dayOfWeek]})
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-gray-500 dark:text-gray-400">No availability set.</p>
                        )}

                        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                          <p className="text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-300">
                              Comfortable as skip:
                            </span>{' '}
                            <span
                              className={
                                memberAvailability.canSkip
                                  ? 'text-green-600 dark:text-green-400 font-medium'
                                  : 'text-gray-600 dark:text-gray-400'
                              }
                            >
                              {memberAvailability.canSkip ? 'Yes' : 'No'}
                            </span>
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-500 dark:text-gray-400">
                        Unable to load availability.
                      </div>
                    )}
                  </div>
                )}

                {profileModalTab === 'leagues' && (
                  <div>
                    <h3 className="app-section-title mb-3">
                      Leagues & Teams
                    </h3>
                    {loadingLeagues ? (
                      <InlineStateMessage title="Loading leagues..." />
                    ) : memberLeagues && memberLeagues.length > 0 ? (
                      <ul className="space-y-3">
                        {memberLeagues.map((entry) => (
                          <li
                            key={entry.leagueId}
                            className="flex flex-col p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                          >
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {entry.leagueName}
                            </span>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {DAY_NAMES[entry.dayOfWeek]}
                            </span>
                            {entry.teamName ? (
                              <button
                                type="button"
                                onClick={() =>
                                  entry.teamId &&
                                  entry.teamName &&
                                  setTeamRosterModal({
                                    teamId: entry.teamId,
                                    teamName: entry.teamName,
                                  })
                                }
                                className="text-sm text-primary-teal-link dark:text-primary-teal-link/90 mt-1 hover:underline text-left"
                              >
                                Team: {entry.teamName}
                              </button>
                            ) : (
                              <span className="text-sm text-gray-500 dark:text-gray-500 italic mt-1">
                                Not yet assigned to a team
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <InlineStateMessage title="Not on any league rosters." />
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 flex justify-end">
                <Button variant="secondary" onClick={handleCloseModal}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal
          isOpen={!!teamRosterModal}
          onClose={() => setTeamRosterModal(null)}
          title={teamRosterModal ? `${teamRosterModal.teamName} — Roster` : 'Team roster'}
          size="md"
        >
          {teamRosterModal && (
            <div className="space-y-4">
              {teamRosterLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
              ) : teamRoster.length === 0 ? (
                <div className="text-sm text-gray-600 dark:text-gray-400">No roster set.</div>
              ) : (
                <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                  {teamRoster.map((member) => (
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
      </AppPage>
    </>
  );
}
