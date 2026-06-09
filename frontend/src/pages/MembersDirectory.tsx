import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import { get } from '../api/client';
import { formatPhone } from '../utils/phone';
import AppPageControlsRow from '../components/AppPageControlsRow';
import InlineStateMessage from '../components/InlineStateMessage';
import Modal from '../components/Modal';
import Button from '../components/Button';
import { HiCheckCircle } from 'react-icons/hi2';
import PageTabs from '../components/PageTabs';
import AppStateCard from '../components/AppStateCard';
import DataTable from '../components/table/DataTable';
import type { DataTableColumn } from '../components/table/tableTypes';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';

interface Member {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  isAdmin: boolean;
  isServerAdmin: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
  firstLoginCompleted: boolean;
}

interface MemberAvailability {
  canSkip: boolean;
  availableLeagues: {
    leagueId: number;
    leagueName: string;
    dayOfWeek: number;
  }[];
}

interface LeagueOption {
  id: number;
  name: string;
  dayOfWeek: number;
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

type MemberProfileTab = 'profile' | 'emergency-contact' | 'sparing' | 'leagues';

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
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [leagueFilterId, setLeagueFilterId] = useState<string>(''); // '' = all leagues
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberAvailability, setMemberAvailability] = useState<MemberAvailability | null>(null);
  const [memberLeagues, setMemberLeagues] = useState<MemberLeague[] | null>(null);
  const [memberEmergencyContact, setMemberEmergencyContact] = useState<MemberEmergencyContact | null>(
    null
  );
  const [memberExperience, setMemberExperience] = useState<MemberExperienceSummary | null>(null);
  const [activeTab, setActiveTab] = useState<MemberProfileTab>('profile');
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

  useEffect(() => {
    loadLeagues();
    loadMembers();
  }, []);

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

  const loadLeagues = async () => {
    try {
      const response = await get('/leagues');
      setLeagues(response || []);
    } catch (error) {
      console.error('Failed to load leagues:', error);
      setLeagues([]);
    }
  };

  const loadMembers = async (leagueId?: number) => {
    setLoading(true);
    try {
      const response = await get('/members/directory', leagueId ? { leagueId } : undefined);
      setMembers(Array.isArray(response) ? response : []);
    } catch (error) {
      console.error('Failed to load members:', error);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredMembers = members.filter((member) => member.name.toLowerCase().includes(filter.toLowerCase()));

  const columns: Array<DataTableColumn<Member>> = useMemo(
    () => [
      {
        id: 'name',
        header: 'Name',
        cellClassName: 'whitespace-nowrap',
        renderCell: (member) => (
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
              {member.firstLoginCompleted ? (
                <div className="group relative">
                  <HiCheckCircle className="h-5 w-5 text-green-500" />
                  <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 dark:bg-gray-700">
                    Verified spares list user
                  </span>
                </div>
              ) : null}
            </div>
            <button
              onClick={() => handleMemberClick(member)}
              className="cursor-pointer text-left font-medium text-gray-900 hover:text-primary-teal dark:text-gray-100"
            >
              {member.name}
            </button>
          </div>
        ),
      },
      {
        id: 'email',
        header: 'Email',
        cellClassName: 'whitespace-nowrap',
        renderCell: (member) =>
          member.email ? (
            <a href={`mailto:${member.email}`} className="text-primary-teal hover:underline">
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
    [filter]
  );

  const handleMemberClick = async (member: Member) => {
    setSelectedMember(member);
    setActiveTab('profile');
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
  };

  const handleCloseModal = () => {
    setSelectedMember(null);
    setMemberAvailability(null);
    setMemberLeagues(null);
    setMemberEmergencyContact(null);
    setMemberExperience(null);
    setActiveTab('profile');
    setTeamRosterModal(null);
  };

  const leagueFilterOptions = useMemo<ChoiceOption<number>[]>(
    () =>
      leagues.map((l) => ({
        value: l.id,
        label: `${l.name} (${DAY_NAMES[l.dayOfWeek]})`,
      })),
    [leagues]
  );

  return (
    <Layout>
      <AppPage>
        <AppPageHeader title="Member directory" />

        <AppPageControlsRow
          right={
            <>
              <div className="w-full sm:w-72">
                <ChoiceInput<number>
                  ariaLabel="Filter members by league availability"
                  options={leagueFilterOptions}
                  value={leagueFilterId === '' ? null : parseInt(leagueFilterId, 10)}
                  onChange={(next) => {
                    if (next == null || Array.isArray(next)) {
                      setLeagueFilterId('');
                      loadMembers(undefined);
                      return;
                    }
                    setLeagueFilterId(String(next));
                    loadMembers(next);
                  }}
                  placeholder="Filter by league availability (all)"
                  listboxLabel="League availability filter"
                />
              </div>
              <div className="w-full sm:w-64">
                <input
                  type="text"
                  placeholder="Search members..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="app-input"
                />
              </div>
            </>
          }
        />

        {loading ? (
          <AppStateCard title="Loading members..." />
        ) : (
          <DataTable
            rows={filteredMembers}
            rowKey={(member) => member.id}
            columns={columns}
            emptyState={
              <AppStateCard
                compact
                title={members.length === 0 ? 'No members in the directory.' : `No members found matching "${filter}"`}
              />
            }
          />
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
                    isActive: activeTab === 'profile',
                    onClick: () => setActiveTab('profile'),
                  },
                  {
                    key: 'emergency-contact',
                    label: 'Emergency contact',
                    isActive: activeTab === 'emergency-contact',
                    onClick: () => setActiveTab('emergency-contact'),
                  },
                  {
                    key: 'sparing',
                    label: 'Sparing availability',
                    isActive: activeTab === 'sparing',
                    onClick: () => setActiveTab('sparing'),
                  },
                  {
                    key: 'leagues',
                    label: 'Leagues',
                    isActive: activeTab === 'leagues',
                    onClick: () => setActiveTab('leagues'),
                  },
                ]}
              />

              {/* Tab content */}
              <div className="overflow-y-auto flex-1 min-h-0">
                {activeTab === 'profile' && (
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
                            className="text-primary-teal hover:underline"
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

                {activeTab === 'emergency-contact' && (
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

                {activeTab === 'sparing' && (
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

                {activeTab === 'leagues' && (
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
                                className="text-sm text-primary-teal dark:text-primary-teal/90 mt-1 hover:underline text-left"
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
    </Layout>
  );
}
