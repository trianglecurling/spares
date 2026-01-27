import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface League {
  id: number;
  name: string;
  format: 'teams' | 'doubles';
}

interface Division {
  id: number;
  leagueId: number;
  name: string;
  sortOrder: number;
  isDefault: boolean;
}

interface RosterMember {
  memberId: number;
  name: string;
  role: 'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2';
  isSkip: boolean;
  isVice: boolean;
}

interface Team {
  id: number;
  leagueId: number;
  divisionId: number;
  divisionName: string;
  name: string | null;
  roster: RosterMember[];
}

interface MemberSearchResult {
  id: number;
  name: string;
  email: string | null;
}

const roleLabels: Record<RosterMember['role'], string> = {
  lead: 'Lead',
  second: 'Second',
  third: 'Third',
  fourth: 'Fourth',
  player1: 'Player 1',
  player2: 'Player 2',
};

export default function AdminLeagueSetup() {
  const { leagueId } = useParams();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();

  const [league, setLeague] = useState<League | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTab, setActiveTab] = useState<'divisions' | 'teams'>('divisions');
  const [loading, setLoading] = useState(true);

  const [divisionModalOpen, setDivisionModalOpen] = useState(false);
  const [editingDivision, setEditingDivision] = useState<Division | null>(null);
  const [divisionForm, setDivisionForm] = useState({
    name: '',
    sortOrder: 0,
    isDefault: false,
  });
  const [divisionSubmitting, setDivisionSubmitting] = useState(false);

  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamForm, setTeamForm] = useState({
    name: '',
    divisionId: 0,
  });
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [teamSubmitting, setTeamSubmitting] = useState(false);

  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<MemberSearchResult[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);
  const [selectedRole, setSelectedRole] = useState<RosterMember['role'] | ''>('');

  const numericLeagueId = useMemo(() => parseInt(leagueId || '', 10), [leagueId]);

  const roleOptions = useMemo(() => {
    if (!league) return [];
    return league.format === 'doubles'
      ? ['player1', 'player2']
      : ['lead', 'second', 'third', 'fourth'];
  }, [league]);

  useEffect(() => {
    if (!Number.isFinite(numericLeagueId)) {
      showAlert('Invalid league ID', 'error');
      navigate('/admin/leagues');
      return;
    }
    loadAll();
  }, [numericLeagueId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const leaguesResponse = await api.get('/leagues');
      const currentLeague = leaguesResponse.data.find((l: League) => l.id === numericLeagueId);
      if (!currentLeague) {
        showAlert('League not found', 'error');
        navigate('/admin/leagues');
        return;
      }
      setLeague(currentLeague);

      const [divisionsResponse, teamsResponse] = await Promise.all([
        api.get(`/leagues/${numericLeagueId}/divisions`),
        api.get(`/leagues/${numericLeagueId}/teams`),
      ]);

      setDivisions(divisionsResponse.data);
      setTeams(teamsResponse.data);
    } catch (error) {
      console.error('Failed to load league setup data:', error);
      showAlert('Failed to load league setup data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDivisionModal = (division?: Division) => {
    if (division) {
      setEditingDivision(division);
      setDivisionForm({
        name: division.name,
        sortOrder: division.sortOrder,
        isDefault: division.isDefault,
      });
    } else {
      setEditingDivision(null);
      setDivisionForm({
        name: '',
        sortOrder: divisions.length,
        isDefault: divisions.length === 0,
      });
    }
    setDivisionModalOpen(true);
  };

  const handleCloseDivisionModal = () => {
    setDivisionModalOpen(false);
    setEditingDivision(null);
    setDivisionForm({
      name: '',
      sortOrder: 0,
      isDefault: false,
    });
  };

  const handleDivisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDivisionSubmitting(true);

    try {
      const payload = {
        name: divisionForm.name,
        sortOrder: divisionForm.sortOrder,
        isDefault: divisionForm.isDefault,
      };

      if (editingDivision) {
        await api.patch(`/leagues/${numericLeagueId}/divisions/${editingDivision.id}`, payload);
      } else {
        await api.post(`/leagues/${numericLeagueId}/divisions`, payload);
      }

      await loadAll();
      handleCloseDivisionModal();
    } catch (error: any) {
      console.error('Failed to save division:', error);
      showAlert(error.response?.data?.error || 'Failed to save division', 'error');
    } finally {
      setDivisionSubmitting(false);
    }
  };

  const handleDeleteDivision = async (division: Division) => {
    const confirmed = await confirm({
      title: 'Delete division',
      message: `Are you sure you want to delete ${division.name}?`,
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (!confirmed) return;

    try {
      await api.delete(`/leagues/${numericLeagueId}/divisions/${division.id}`);
      setDivisions((prev) => prev.filter((d) => d.id !== division.id));
    } catch (error: any) {
      console.error('Failed to delete division:', error);
      showAlert(error.response?.data?.error || 'Failed to delete division', 'error');
    }
  };

  const handleOpenTeamModal = (team?: Team) => {
    if (!league) return;
    if (!team && divisions.length === 0) {
      showAlert('Create a division before adding teams.', 'warning');
      return;
    }

    if (team) {
      setEditingTeam(team);
      setTeamForm({
        name: team.name || '',
        divisionId: team.divisionId,
      });
      setRoster(team.roster || []);
    } else {
      setEditingTeam(null);
      setTeamForm({
        name: '',
        divisionId: divisions[0]?.id || 0,
      });
      setRoster([]);
    }

    setSelectedMember(null);
    setSelectedRole('');
    setMemberQuery('');
    setMemberResults([]);
    setTeamModalOpen(true);
  };

  const handleCloseTeamModal = () => {
    setTeamModalOpen(false);
    setEditingTeam(null);
    setTeamForm({
      name: '',
      divisionId: 0,
    });
    setRoster([]);
  };

  const handleSearchMembers = async () => {
    if (memberQuery.trim().length < 2) {
      showAlert('Enter at least 2 characters to search', 'warning');
      return;
    }

    setMemberLoading(true);
    try {
      const response = await api.get('/members/search', {
        params: { query: memberQuery.trim(), leagueId: numericLeagueId },
      });
      setMemberResults(response.data);
    } catch (error: any) {
      console.error('Failed to search members:', error);
      showAlert(error.response?.data?.error || 'Failed to search members', 'error');
    } finally {
      setMemberLoading(false);
    }
  };

  const handleAddRosterMember = () => {
    if (!selectedMember) {
      showAlert('Select a member to add', 'warning');
      return;
    }
    if (!selectedRole) {
      showAlert('Select a role', 'warning');
      return;
    }
    if (roster.some((member) => member.memberId === selectedMember.id)) {
      showAlert('Member is already on the roster', 'warning');
      return;
    }
    if (roster.some((member) => member.role === selectedRole)) {
      showAlert('That role is already assigned', 'warning');
      return;
    }

    setRoster((prev) => [
      ...prev,
      {
        memberId: selectedMember.id,
        name: selectedMember.name,
        role: selectedRole,
        isSkip: false,
        isVice: false,
      },
    ]);

    setSelectedMember(null);
    setSelectedRole('');
    setMemberQuery('');
    setMemberResults([]);
  };

  const updateRosterMember = (index: number, updates: Partial<RosterMember>) => {
    setRoster((prev) =>
      prev.map((member, idx) => {
        if (idx !== index) return member;
        return { ...member, ...updates };
      })
    );
  };

  const toggleSkip = (index: number) => {
    setRoster((prev) =>
      prev.map((member, idx) => {
        if (idx === index) {
          const nextSkip = !member.isSkip;
          return { ...member, isSkip: nextSkip, isVice: nextSkip ? false : member.isVice };
        }
        return { ...member, isSkip: false };
      })
    );
  };

  const toggleVice = (index: number) => {
    setRoster((prev) =>
      prev.map((member, idx) => {
        if (idx === index) {
          const nextVice = !member.isVice;
          return { ...member, isVice: nextVice, isSkip: nextVice ? false : member.isSkip };
        }
        return { ...member, isVice: false };
      })
    );
  };

  const removeRosterMember = (index: number) => {
    setRoster((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!league) return;

    setTeamSubmitting(true);
    try {
      const payload = {
        name: teamForm.name || undefined,
        divisionId: teamForm.divisionId || undefined,
        members: roster.length > 0
          ? roster.map((member) => ({
              memberId: member.memberId,
              role: member.role,
              isSkip: member.isSkip,
              isVice: member.isVice,
            }))
          : undefined,
      };

      if (editingTeam) {
        await api.patch(`/teams/${editingTeam.id}`, {
          name: teamForm.name || undefined,
          divisionId: teamForm.divisionId || undefined,
        });

        if (roster.length > 0) {
          await api.put(`/teams/${editingTeam.id}/roster`, {
            members: roster.map((member) => ({
              memberId: member.memberId,
              role: member.role,
              isSkip: member.isSkip,
              isVice: member.isVice,
            })),
          });
        }
      } else {
        await api.post(`/leagues/${numericLeagueId}/teams`, payload);
      }

      await loadAll();
      handleCloseTeamModal();
    } catch (error: any) {
      console.error('Failed to save team:', error);
      showAlert(error.response?.data?.error || 'Failed to save team', 'error');
    } finally {
      setTeamSubmitting(false);
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    const confirmed = await confirm({
      title: 'Delete team',
      message: `Are you sure you want to delete ${team.name || 'this team'}?`,
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (!confirmed) return;

    try {
      await api.delete(`/teams/${team.id}`);
      setTeams((prev) => prev.filter((t) => t.id !== team.id));
    } catch (error: any) {
      console.error('Failed to delete team:', error);
      showAlert(error.response?.data?.error || 'Failed to delete team', 'error');
    }
  };

  const teamsByDivision = useMemo(() => {
    const map = new Map<number, Team[]>();
    teams.forEach((team) => {
      const list = map.get(team.divisionId) ?? [];
      list.push(team);
      map.set(team.divisionId, list);
    });
    return map;
  }, [teams]);

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">League not found.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
              {league.name} setup
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manage divisions, teams, and rosters
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/admin/leagues')}>
            Back to leagues
          </Button>
        </div>

        <div className="flex space-x-2">
          <Button
            variant={activeTab === 'divisions' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('divisions')}
          >
            Divisions
          </Button>
          <Button
            variant={activeTab === 'teams' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('teams')}
          >
            Teams
          </Button>
        </div>

        {activeTab === 'divisions' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => handleOpenDivisionModal()}>Add division</Button>
            </div>

            {divisions.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
                <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No divisions yet.</p>
                <Button onClick={() => handleOpenDivisionModal()}>Create a division</Button>
              </div>
            ) : (
              <div className="grid gap-4">
                {divisions.map((division) => (
                  <div key={division.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-2 dark:text-gray-100">
                          {division.name}
                        </h3>
                        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                          <p>
                            <span className="font-medium dark:text-gray-300">Sort order:</span> {division.sortOrder}
                          </p>
                          {division.isDefault && (
                            <p className="text-primary-teal font-medium">Default division</p>
                          )}
                        </div>
                      </div>

                      <div className="flex space-x-2">
                        <Button onClick={() => handleOpenDivisionModal(division)} variant="secondary">
                          Edit
                        </Button>
                        <Button onClick={() => handleDeleteDivision(division)} variant="danger">
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'teams' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => handleOpenTeamModal()} disabled={divisions.length === 0}>
                Add team
              </Button>
            </div>

            {teams.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
                <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No teams yet.</p>
                <Button onClick={() => handleOpenTeamModal()}>Create a team</Button>
              </div>
            ) : (
              <div className="space-y-6">
                {divisions.map((division) => {
                  const divisionTeams = teamsByDivision.get(division.id) || [];
                  if (divisionTeams.length === 0) {
                    return null;
                  }

                  return (
                    <div key={division.id} className="space-y-3">
                      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                        {division.name}
                      </h2>
                      <div className="grid gap-4">
                        {divisionTeams.map((team) => (
                          <div key={team.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                            <div className="flex justify-between items-start gap-4">
                              <div className="flex-1">
                                <h3 className="text-xl font-semibold mb-2 dark:text-gray-100">
                                  {team.name || 'Unnamed team'}
                                </h3>
                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                                  <div>
                                    <span className="font-medium dark:text-gray-300">Roster:</span>
                                    {team.roster.length === 0 ? (
                                      <span className="ml-2">No roster set</span>
                                    ) : (
                                      <ul className="mt-2 space-y-1">
                                        {team.roster.map((member) => (
                                          <li key={member.memberId}>
                                            {member.name} — {roleLabels[member.role]}
                                            {member.isSkip ? ' (Skip)' : ''}
                                            {member.isVice ? ' (Vice)' : ''}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex space-x-2">
                                <Button onClick={() => handleOpenTeamModal(team)} variant="secondary">
                                  Edit
                                </Button>
                                <Button onClick={() => handleDeleteTeam(team)} variant="danger">
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={divisionModalOpen}
        onClose={handleCloseDivisionModal}
        title={editingDivision ? 'Edit division' : 'Add division'}
      >
        <form onSubmit={handleDivisionSubmit} className="space-y-4">
          <div>
            <label htmlFor="divisionName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Division name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="divisionName"
              value={divisionForm.name}
              onChange={(e) => setDivisionForm({ ...divisionForm, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="divisionSort" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Sort order
            </label>
            <input
              type="number"
              id="divisionSort"
              value={divisionForm.sortOrder}
              onChange={(e) => setDivisionForm({ ...divisionForm, sortOrder: parseInt(e.target.value, 10) || 0 })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="divisionDefault"
              checked={divisionForm.isDefault}
              onChange={(e) => setDivisionForm({ ...divisionForm, isDefault: e.target.checked })}
              className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
            />
            <label htmlFor="divisionDefault" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Set as default division
            </label>
          </div>

          <div className="flex space-x-3">
            <Button type="submit" disabled={divisionSubmitting} className="flex-1">
              {divisionSubmitting ? 'Saving...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCloseDivisionModal}
              disabled={divisionSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={teamModalOpen}
        onClose={handleCloseTeamModal}
        title={editingTeam ? 'Edit team' : 'Add team'}
      >
        <form onSubmit={handleTeamSubmit} className="space-y-4">
          <div>
            <label htmlFor="teamName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team name
            </label>
            <input
              type="text"
              id="teamName"
              value={teamForm.name}
              onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="teamDivision" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Division
            </label>
            <select
              id="teamDivision"
              value={teamForm.divisionId}
              onChange={(e) => setTeamForm({ ...teamForm, divisionId: parseInt(e.target.value, 10) })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
            >
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Roster</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {league.format === 'doubles'
                  ? 'Add Player 1 and Player 2.'
                  : 'Add lead, third, fourth (and optional second), then mark skip and vice.'}
              </p>
            </div>

            {roster.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">No roster members yet.</div>
            ) : (
              <div className="space-y-2">
                {roster.map((member, index) => (
                  <div key={member.memberId} className="flex flex-col gap-2 border border-gray-200 dark:border-gray-700 rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{member.name}</p>
                      </div>
                      <button
                        type="button"
                        className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                        onClick={() => removeRosterMember(index)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Role</label>
                        <select
                          value={member.role}
                          onChange={(e) =>
                            updateRosterMember(index, { role: e.target.value as RosterMember['role'] })
                          }
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>
                              {roleLabels[role as RosterMember['role']]}
                            </option>
                          ))}
                        </select>
                      </div>

                      {league.format === 'teams' && (
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                            <input
                              type="checkbox"
                              checked={member.isSkip}
                              onChange={() => toggleSkip(index)}
                              className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
                            />
                            Skip
                          </label>
                          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                            <input
                              type="checkbox"
                              checked={member.isVice}
                              onChange={() => toggleVice(index)}
                              className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
                            />
                            Vice
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Add roster member</div>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  type="text"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Search members by name or email"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                />
                <Button type="button" variant="secondary" onClick={handleSearchMembers} disabled={memberLoading}>
                  {memberLoading ? 'Searching...' : 'Search'}
                </Button>
              </div>

              {memberResults.length > 0 && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-md max-h-40 overflow-y-auto">
                  {memberResults.map((result) => (
                    <button
                      type="button"
                      key={result.id}
                      onClick={() => {
                        setSelectedMember(result);
                        setMemberResults([]);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        selectedMember?.id === result.id ? 'bg-gray-100 dark:bg-gray-700' : ''
                      }`}
                    >
                      <div className="font-medium text-gray-800 dark:text-gray-200">{result.name}</div>
                      {result.email && <div className="text-xs text-gray-500 dark:text-gray-400">{result.email}</div>}
                    </button>
                  ))}
                </div>
              )}

              {selectedMember && (
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  Selected: <span className="font-medium">{selectedMember.name}</span>
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-2 items-center">
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as RosterMember['role'])}
                  className="w-full md:w-auto px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                >
                  <option value="">Select role...</option>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role as RosterMember['role']]}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="secondary" onClick={handleAddRosterMember}>
                  Add to roster
                </Button>
              </div>
            </div>
          </div>

          <div className="flex space-x-3">
            <Button type="submit" disabled={teamSubmitting} className="flex-1">
              {teamSubmitting ? 'Saving...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCloseTeamModal}
              disabled={teamSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
