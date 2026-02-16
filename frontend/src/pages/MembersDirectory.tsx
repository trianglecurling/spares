import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { get } from '../api/client';
import { formatPhone } from '../utils/phone';
import Modal from '../components/Modal';
import Button from '../components/Button';
import { HiCheckCircle } from 'react-icons/hi2';

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

type MemberProfileTab = 'profile' | 'sparing' | 'leagues';

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
  const [activeTab, setActiveTab] = useState<MemberProfileTab>('profile');
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
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

  const filteredMembers = members.filter((member) =>
    member.name.toLowerCase().includes(filter.toLowerCase())
  );

  const handleMemberClick = async (member: Member) => {
    setSelectedMember(member);
    setActiveTab('profile');
    setMemberAvailability(null);
    setMemberLeagues(null);

    setLoadingAvailability(true);
    setLoadingLeagues(true);
    try {
      const [availabilityRes, leaguesRes] = await Promise.all([
        get('/members/{memberId}/availability', undefined, {
          memberId: String(member.id),
        }),
        get('/members/{memberId}/leagues', undefined, {
          memberId: String(member.id),
        }),
      ]);
      setMemberAvailability(availabilityRes);
      setMemberLeagues(Array.isArray(leaguesRes) ? leaguesRes : []);
    } catch (error) {
      console.error('Failed to load member data:', error);
      setMemberAvailability({ canSkip: false, availableLeagues: [] });
      setMemberLeagues([]);
    } finally {
      setLoadingAvailability(false);
      setLoadingLeagues(false);
    }
  };

  const handleCloseModal = () => {
    setSelectedMember(null);
    setMemberAvailability(null);
    setMemberLeagues(null);
    setActiveTab('profile');
    setTeamRosterModal(null);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">Member directory</h1>
          <div className="w-full md:w-auto flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-72">
              <select
                value={leagueFilterId}
                onChange={(e) => {
                  const value = e.target.value;
                  setLeagueFilterId(value);
                  const parsed = value ? parseInt(value, 10) : undefined;
                  loadMembers(parsed);
                }}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              >
                <option value="">Filter by league availability (all)</option>
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({DAY_NAMES[l.dayOfWeek]})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="Search members..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Role
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 relative">
                          <div className="w-5 h-5 flex-shrink-0">
                            {member.firstLoginCompleted && (
                              <div className="group relative">
                                <HiCheckCircle className="text-green-500 w-5 h-5" />
                                <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity duration-200 shadow-lg">
                                  Verified spares list user
                                </span>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleMemberClick(member)}
                            className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary-teal cursor-pointer text-left"
                          >
                            {member.name}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {member.email ? (
                          <a
                            href={`mailto:${member.email}`}
                            className="text-primary-teal hover:underline"
                          >
                            {member.email}
                          </a>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {member.phone ? (
                          <a
                            href={`tel:${member.phone.replace(/\D/g, '')}`}
                            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                          >
                            {formatPhone(member.phone)}
                          </a>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {member.isServerAdmin ? (
                          <span className="px-2 py-1 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 rounded">
                            Server admin
                          </span>
                        ) : member.isAdmin ? (
                          <span className="px-2 py-1 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded">
                            Admin
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredMembers.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                      >
                        {members.length === 0
                          ? 'No members in the directory.'
                          : `No members found matching "${filter}"`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Modal
          isOpen={!!selectedMember}
          onClose={handleCloseModal}
          title={selectedMember ? `${selectedMember.name}'s Profile` : ''}
          size="lg"
        >
          {selectedMember && (
            <div className="flex flex-col min-h-[400px]">
              {/* Tabs */}
              <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                {(['profile', 'sparing', 'leagues'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === tab
                        ? 'border-primary-teal text-primary-teal'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    {tab === 'profile'
                      ? 'Profile'
                      : tab === 'sparing'
                        ? 'Sparing availability'
                        : 'Leagues'}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="overflow-y-auto flex-1 min-h-0">
                {activeTab === 'profile' && (
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold mb-3 text-[#121033] dark:text-gray-100">
                      Contact Information
                    </h3>
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
                )}

                {activeTab === 'sparing' && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 text-[#121033] dark:text-gray-100">
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
                    <h3 className="text-lg font-semibold mb-3 text-[#121033] dark:text-gray-100">
                      Leagues & Teams
                    </h3>
                    {loadingLeagues ? (
                      <div className="text-gray-500 dark:text-gray-400">Loading leagues...</div>
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
                      <p className="text-gray-500 dark:text-gray-400">
                        Not on any league rosters.
                      </p>
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
      </div>
    </Layout>
  );
}
