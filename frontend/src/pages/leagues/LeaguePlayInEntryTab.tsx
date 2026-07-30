import { useCallback, useEffect, useId, useState } from 'react';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import InlineStateMessage from '../../components/InlineStateMessage';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import Modal from '../../components/Modal';
import AppStateCard from '../../components/AppStateCard';
import DataTable from '../../components/table/DataTable';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { getApiErrorMessage } from '../../utils/api';

type EntryTeamStatus = 'pending' | 'guaranteed' | 'playdown' | 'entered' | 'not_entered' | 'withdrawn';
type EntryProjectedStatus =
  | 'guaranteed'
  | 'projected_in'
  | 'projected_playdown'
  | 'ineligible_single_returner'
  | 'entered'
  | 'not_entered'
  | 'withdrawn';

type EntryPointsRow = {
  id: number;
  memberId: number;
  memberName: string;
  points: number;
  countsAsReturning: boolean;
  source: 'manual' | 'standings' | 'playdown';
  notes: string | null;
};

type EntryTeamMemberRow = {
  id: number;
  memberId: number | null;
  memberName: string | null;
  pendingName: string | null;
  entryType: 'add' | 'replace';
  replacesLeagueId: number | null;
  replacesLeagueName: string | null;
  points: number;
  countsAsReturning: boolean;
  registered: boolean;
};

type EntryTeamRow = {
  id: number;
  name: string | null;
  status: EntryTeamStatus;
  projectedStatus: EntryProjectedStatus;
  totalPoints: number;
  returningMemberCount: number;
  meetsReturningRule: boolean;
  guaranteed: boolean;
  notes: string | null;
  members: EntryTeamMemberRow[];
};

type LeagueEntryReport = {
  league: {
    id: number;
    name: string;
    isPlayInBased: boolean;
    capacityValue: number;
    capacityType: string;
    playInSpotCount: number;
    autoEntryCount: number;
    teamSize: number;
  };
  summary: {
    guaranteeThresholdPoints: number | null;
    returningRuleWaiverActive: boolean;
    activeTeamCount: number;
    guaranteedTeamCount: number;
    projectedInTeamCount: number;
    projectedPlaydownTeamCount: number;
    ineligibleTeamCount: number;
    enteredTeamCount: number;
  };
  points: EntryPointsRow[];
  teams: EntryTeamRow[];
  canManage: boolean;
};

const TEAM_STATUS_LABELS: Record<EntryTeamStatus, string> = {
  pending: 'Pending',
  guaranteed: 'Guaranteed',
  playdown: 'Playdown',
  entered: 'Entered',
  not_entered: 'Not entered',
  withdrawn: 'Withdrawn',
};

const PROJECTED_STATUS_LABELS: Record<EntryProjectedStatus, string> = {
  guaranteed: 'Guaranteed entry',
  projected_in: 'Projected in',
  projected_playdown: 'Projected playdown',
  ineligible_single_returner: 'Ineligible (single returner)',
  entered: 'Entered',
  not_entered: 'Not entered',
  withdrawn: 'Withdrawn',
};

/** TLINE points display: whole numbers stay whole, halves render as 19½. */
function formatTlinePoints(points: number): string {
  const whole = Math.floor(points);
  const hasHalf = Math.abs(points - whole - 0.5) < 1e-9;
  if (hasHalf) return `${whole}\u00bd`;
  return String(points);
}

function projectedStatusBadgeClasses(status: EntryProjectedStatus): string {
  if (status === 'guaranteed' || status === 'entered' || status === 'projected_in') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
  }
  if (status === 'ineligible_single_returner' || status === 'not_entered') {
    return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';
  }
  if (status === 'withdrawn') {
    return 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  }
  return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200';
}

type PointsFormState = {
  editingId: number | null;
  memberId: number | '';
  points: string;
  countsAsReturning: boolean;
  notes: string;
};

const emptyPointsForm: PointsFormState = {
  editingId: null,
  memberId: '',
  points: '',
  countsAsReturning: true,
  notes: '',
};

type TeamEditorMemberRow = {
  key: string;
  memberId: number | '';
  pendingName: string;
  entryType: 'add' | 'replace';
  replacesLeagueId: number | null;
};

type TeamEditorState = {
  teamId: number | null;
  name: string;
  notes: string;
  members: TeamEditorMemberRow[];
};

function emptyTeamEditorMember(index: number): TeamEditorMemberRow {
  return { key: `new-${index}-${Date.now()}`, memberId: '', pendingName: '', entryType: 'add', replacesLeagueId: null };
}

export default function LeaguePlayInEntryTab({ leagueId }: { leagueId: number }) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const pointsMemberInputId = useId();
  const pointsValueInputId = useId();
  const pointsNotesInputId = useId();
  const teamNameInputId = useId();
  const teamNotesInputId = useId();
  const linkMemberInputId = useId();

  const [report, setReport] = useState<LeagueEntryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pointsForm, setPointsForm] = useState<PointsFormState>(emptyPointsForm);
  const [pointsSaving, setPointsSaving] = useState(false);

  const [teamEditor, setTeamEditor] = useState<TeamEditorState | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);

  const [linkTarget, setLinkTarget] = useState<{ team: EntryTeamRow; pendingRowId: number } | null>(null);
  const [linkMemberId, setLinkMemberId] = useState<number | ''>('');
  const [linkSaving, setLinkSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get<LeagueEntryReport>(`/leagues/${leagueId}/entry/report`);
      setReport(response.data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load play-in entry data.'));
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const canManage = report?.canManage ?? false;
  const teamSize = report?.league.teamSize ?? 4;

  async function savePoints() {
    if (pointsForm.memberId === '') {
      showAlert('Choose a member before saving points.', 'warning');
      return;
    }
    const pointsValue = Number(pointsForm.points);
    if (!Number.isFinite(pointsValue) || pointsValue < 0) {
      showAlert('Enter a valid points value (whole or half numbers).', 'warning');
      return;
    }
    setPointsSaving(true);
    try {
      await api.put(`/leagues/${leagueId}/entry/points`, {
        memberId: pointsForm.memberId,
        points: pointsValue,
        countsAsReturning: pointsForm.countsAsReturning,
        notes: pointsForm.notes.trim() || null,
      });
      setPointsForm(emptyPointsForm);
      requestAnimationFrame(() => {
        document.getElementById(pointsMemberInputId)?.focus();
      });
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to save TLINE points.'), 'error');
    } finally {
      setPointsSaving(false);
    }
  }

  async function deletePoints(row: EntryPointsRow) {
    const ok = await confirm({
      title: 'Delete points entry?',
      message: `Delete the ${formatTlinePoints(row.points)}-point entry for ${row.memberName}?`,
      confirmText: 'Delete',
      cancelText: 'Keep',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/leagues/${leagueId}/entry/points/${row.id}`);
      showAlert('Points entry deleted.', 'success');
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to delete points entry.'), 'error');
    }
  }

  function openTeamEditor(team: EntryTeamRow | null) {
    if (team) {
      setTeamEditor({
        teamId: team.id,
        name: team.name ?? '',
        notes: team.notes ?? '',
        members: team.members.map((member) => ({
          key: `existing-${member.id}`,
          memberId: member.memberId ?? '',
          pendingName: member.pendingName ?? '',
          entryType: member.entryType,
          replacesLeagueId: member.replacesLeagueId,
        })),
      });
      return;
    }
    setTeamEditor({
      teamId: null,
      name: '',
      notes: '',
      members: [emptyTeamEditorMember(0)],
    });
  }

  async function saveTeamEditor() {
    if (!teamEditor) return;
    const members = teamEditor.members
      .filter((member) => member.memberId !== '' || member.pendingName.trim())
      .map((member) => ({
        memberId: member.memberId === '' ? null : member.memberId,
        pendingName: member.memberId === '' ? member.pendingName.trim() || null : null,
        entryType: member.entryType,
        replacesLeagueId: member.entryType === 'replace' ? member.replacesLeagueId : null,
      }));
    if (members.length === 0) {
      showAlert('Add at least one teammate before saving.', 'warning');
      return;
    }
    setTeamSaving(true);
    try {
      if (teamEditor.teamId == null) {
        await api.post(`/leagues/${leagueId}/entry/teams`, {
          name: teamEditor.name.trim() || null,
          notes: teamEditor.notes.trim() || null,
          members,
        });
        showAlert('Entry team created.', 'success');
      } else {
        await api.patch(`/leagues/${leagueId}/entry/teams/${teamEditor.teamId}`, {
          name: teamEditor.name.trim() || null,
          notes: teamEditor.notes.trim() || null,
          members,
        });
        showAlert('Entry team updated.', 'success');
      }
      setTeamEditor(null);
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to save entry team.'), 'error');
    } finally {
      setTeamSaving(false);
    }
  }

  async function setTeamStatus(team: EntryTeamRow, status: 'pending' | 'withdrawn') {
    if (status === 'withdrawn') {
      const granted = team.status === 'entered';
      const ok = await confirm({
        title: granted ? 'Withdraw granted entry?' : 'Withdraw team?',
        message: granted
          ? `Withdraw ${teamDisplayName(team)} after granting entry? They are removed from the league roster and Teams tab (when the team matches this entry), return to the available pool, and play-in registrations for this league will not be billed. You can reinstate the declaration later and grant entry again if needed.`
          : `Withdraw ${teamDisplayName(team)} from ${report?.league.name ?? 'this league'} entry? Members return to the available pool, and play-in registrations for this league will not be billed. You can reinstate the team later if needed.`,
        confirmText: 'Withdraw team',
        cancelText: 'Keep team',
        variant: 'warning',
      });
      if (!ok) return;
    }
    try {
      await api.patch(`/leagues/${leagueId}/entry/teams/${team.id}`, { status });
      showAlert(status === 'withdrawn' ? 'Team withdrawn.' : 'Team reinstated.', 'success');
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to update team status.'), 'error');
    }
  }

  async function grantEntry(team: EntryTeamRow) {
    const ok = await confirm({
      title: 'Grant entry?',
      message: `Grant ${teamDisplayName(team)} entry into ${report?.league.name ?? 'this league'}? Registered members are placed on the league roster, added as a team on the Teams tab, and deferred payments are requested.`,
      confirmText: 'Grant entry',
      cancelText: 'Cancel',
      variant: 'info',
    });
    if (!ok) return;
    try {
      const response = await api.post<{
        rosterPlacements: number;
        leagueTeamId: number | null;
        paymentResults: Array<{ registrationId: number; outcome: string; error?: string }>;
      }>(`/leagues/${leagueId}/entry/teams/${team.id}/outcome`, { outcome: 'entered' });
      const paymentErrors = response.data.paymentResults.filter((result) => result.outcome === 'error');
      const teamPart =
        response.data.leagueTeamId != null
          ? ' A league team was created on the Teams tab.'
          : ' No league team was created (no eligible registered members available to assign).';
      showAlert(
        `Entry granted. ${response.data.rosterPlacements} member(s) placed on the roster.${teamPart}${
          paymentErrors.length > 0
            ? ` ${paymentErrors.length} payment request(s) failed and need follow-up.`
            : ''
        }`,
        paymentErrors.length > 0 ? 'warning' : 'success',
      );
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to record the outcome.'), 'error');
    }
  }

  async function saveLinkMember() {
    if (!linkTarget || linkMemberId === '') return;
    setLinkSaving(true);
    try {
      await api.post(`/leagues/${leagueId}/entry/teams/${linkTarget.team.id}/link-member`, {
        teamMemberId: linkTarget.pendingRowId,
        memberId: linkMemberId,
      });
      showAlert('Teammate linked to member account.', 'success');
      setLinkTarget(null);
      setLinkMemberId('');
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to link the teammate.'), 'error');
    } finally {
      setLinkSaving(false);
    }
  }

  function teamDisplayName(team: EntryTeamRow): string {
    if (team.name) return team.name;
    const first = team.members.find((member) => member.memberName || member.pendingName);
    const anchor = first?.memberName ?? first?.pendingName;
    return anchor ? `Team ${anchor}` : `Team #${team.id}`;
  }

  if (loading) {
    return <AppStateCard title="Loading play-in entry data..." />;
  }
  if (error || !report) {
    return <AppStateCard title="Unable to load play-in entry data" description={error ?? undefined} />;
  }

  const summaryItems: Array<{ label: string; value: string }> = [
    {
      label: 'Guaranteed-entry threshold',
      value:
        report.summary.guaranteeThresholdPoints != null
          ? `> ${formatTlinePoints(report.summary.guaranteeThresholdPoints)} pts`
          : 'Not computable',
    },
    { label: 'Auto-entry teams', value: String(report.league.autoEntryCount) },
    { label: 'Play-in spots', value: String(report.league.playInSpotCount) },
    { label: 'Active teams', value: String(report.summary.activeTeamCount) },
    { label: 'Guaranteed', value: String(report.summary.guaranteedTeamCount) },
    { label: 'Projected playdown', value: String(report.summary.projectedPlaydownTeamCount) },
    { label: 'Ineligible (single returner)', value: String(report.summary.ineligibleTeamCount) },
    { label: 'Returning rule', value: report.summary.returningRuleWaiverActive ? 'Waived' : 'Active' },
  ];

  return (
    <div className="space-y-6">
      <div className="app-card space-y-4">
        <h2 className="app-section-title">Entry summary</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summaryItems.map((item) => (
            <div key={item.label} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{item.value}</p>
            </div>
          ))}
        </div>
        {report.summary.returningRuleWaiverActive ? (
          <InlineStateMessage
            tone="warning"
            title="Returning-member rule waived"
            description={`Fewer than ${report.league.autoEntryCount} teams have at least two returning curlers, so the two-returning-members rule is waived this session.`}
          />
        ) : null}
      </div>

      <div className="app-card space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="app-section-title">TLINE points</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Each member's accumulated TLINE points for {report.league.name}. Team totals and the guarantee
              threshold are computed from this ledger.
            </p>
          </div>
        </div>

        {canManage ? (
          <form
            className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
            onSubmit={(event) => {
              event.preventDefault();
              void savePoints();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Member" htmlFor={pointsMemberInputId} required>
                <MemberAutocomplete
                  inputId={pointsMemberInputId}
                  value={pointsForm.memberId}
                  onChange={(next) => setPointsForm((prev) => ({ ...prev, memberId: next }))}
                  disabled={pointsForm.editingId != null}
                />
              </FormField>
              <FormField
                label="Points"
                htmlFor={pointsValueInputId}
                required
                helperText="Whole or half values, e.g. 19 or 19.5."
              >
                <input
                  id={pointsValueInputId}
                  type="number"
                  min={0}
                  step={0.5}
                  className="app-input"
                  value={pointsForm.points}
                  onChange={(event) => setPointsForm((prev) => ({ ...prev, points: event.target.value }))}
                />
              </FormField>
              <FormField label="Notes" htmlFor={pointsNotesInputId} optional>
                <input
                  id={pointsNotesInputId}
                  type="text"
                  className="app-input"
                  value={pointsForm.notes}
                  onChange={(event) => setPointsForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </FormField>
              <div className="flex flex-col justify-end gap-2">
                <FormCheckbox
                  label="Counts as returning"
                  helperText="Playdown losers earn 1 point but did not play in the league."
                  checked={pointsForm.countsAsReturning}
                  onChange={(checked) => setPointsForm((prev) => ({ ...prev, countsAsReturning: checked }))}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" disabled={pointsSaving}>
                {pointsForm.editingId != null ? 'Save points' : 'Add points'}
              </Button>
              {pointsForm.editingId != null ? (
                <Button type="button" variant="secondary" onClick={() => setPointsForm(emptyPointsForm)}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}

        <DataTable
          rows={report.points}
          rowKey={(row) => row.id}
          emptyState={
            <InlineStateMessage
              title="No TLINE points yet"
              description="Seed each member's points before registration opens so guarantee evaluation works."
            />
          }
          columns={[
            { id: 'member', header: 'Member', renderCell: (row) => row.memberName },
            {
              id: 'points',
              header: 'Points',
              align: 'right',
              renderCell: (row) => <span className="tabular-nums">{formatTlinePoints(row.points)}</span>,
            },
            {
              id: 'returning',
              header: 'Returning',
              renderCell: (row) => (row.countsAsReturning ? 'Yes' : 'No'),
            },
            { id: 'source', header: 'Source', renderCell: (row) => row.source },
            {
              id: 'notes',
              header: 'Notes',
              renderCell: (row) => row.notes ?? '',
              cellClassName: 'max-w-64 truncate',
            },
          ]}
          actions={
            canManage
              ? {
                  widthClassName: 'w-40',
                  renderActions: (row) => (
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                       
                        disabled={row.source !== 'manual'}
                        onClick={() =>
                          setPointsForm({
                            editingId: row.id,
                            memberId: row.memberId,
                            points: String(row.points),
                            countsAsReturning: row.countsAsReturning,
                            notes: row.notes ?? '',
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button type="button" variant="outline-danger" onClick={() => void deletePoints(row)}>
                        Delete
                      </Button>
                    </div>
                  ),
                }
              : undefined
          }
        />
      </div>

      <div className="app-card space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="app-section-title">Entry teams</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Declared teams for {report.league.name}. Teams above the threshold are guaranteed entry; the rest
              play down for the remaining {report.league.playInSpotCount} spot(s).
            </p>
          </div>
          {canManage ? (
            <Button type="button" onClick={() => openTeamEditor(null)}>
              Add team
            </Button>
          ) : null}
        </div>

        <DataTable
          rows={report.teams}
          rowKey={(row) => row.id}
          emptyState={
            <InlineStateMessage
              title="No entry teams yet"
              description="Teams appear here as members register, or staff can add them manually."
            />
          }
          columns={[
            {
              id: 'team',
              header: 'Team',
              renderCell: (row) => (
                <div className="space-y-1">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{teamDisplayName(row)}</p>
                  <ul className="space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                    {row.members.map((member) => (
                      <li key={member.id}>
                        {member.memberName ?? member.pendingName}
                        {member.pendingName ? (
                          <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                            pending member
                          </span>
                        ) : null}
                        {' · '}
                        <span className="tabular-nums">{formatTlinePoints(member.points)} pts</span>
                        {member.memberId != null ? (member.registered ? ' · registered' : ' · not registered') : null}
                        {member.entryType === 'replace'
                          ? ` · REPLACE${member.replacesLeagueName ? ` (${member.replacesLeagueName})` : ''}`
                          : ''}
                      </li>
                    ))}
                  </ul>
                  {row.notes ? <p className="text-xs text-gray-500 dark:text-gray-400">Note: {row.notes}</p> : null}
                </div>
              ),
            },
            {
              id: 'total',
              header: 'Total points',
              align: 'right',
              renderCell: (row) => <span className="tabular-nums font-medium">{formatTlinePoints(row.totalPoints)}</span>,
            },
            {
              id: 'returning',
              header: 'Returning',
              align: 'center',
              renderCell: (row) => row.returningMemberCount,
            },
            {
              id: 'status',
              header: 'Status',
              renderCell: (row) => (
                <div className="space-y-1">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${projectedStatusBadgeClasses(row.projectedStatus)}`}
                  >
                    {PROJECTED_STATUS_LABELS[row.projectedStatus]}
                  </span>
                  {row.status !== 'pending' ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Recorded: {TEAM_STATUS_LABELS[row.status]}</p>
                  ) : null}
                </div>
              ),
            },
          ]}
          actions={
            canManage
              ? {
                  widthClassName: 'w-56',
                  renderActions: (row) => (
                    <div className="flex flex-wrap justify-end gap-2">
                      {row.status !== 'entered' && row.status !== 'withdrawn' && row.status !== 'not_entered' ? (
                        <Button type="button" onClick={() => void grantEntry(row)}>
                          Grant entry
                        </Button>
                      ) : null}
                      {row.members.some((member) => member.pendingName) ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            const pendingRow = row.members.find((member) => member.pendingName);
                            if (pendingRow) {
                              setLinkTarget({ team: row, pendingRowId: pendingRow.id });
                              setLinkMemberId('');
                            }
                          }}
                        >
                          Link member
                        </Button>
                      ) : null}
                      <Button type="button" variant="secondary" onClick={() => openTeamEditor(row)}>
                        Edit
                      </Button>
                      {row.status === 'withdrawn' || row.status === 'not_entered' ? (
                        <Button type="button" variant="secondary" onClick={() => void setTeamStatus(row, 'pending')}>
                          Reinstate
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline-danger"
                          onClick={() => void setTeamStatus(row, 'withdrawn')}
                        >
                          Withdraw
                        </Button>
                      )}
                    </div>
                  ),
                }
              : undefined
          }
        />
      </div>

      <Modal
        isOpen={teamEditor != null}
        onClose={() => setTeamEditor(null)}
        title={teamEditor?.teamId == null ? 'Add entry team' : 'Edit entry team'}
        size="lg"
        contentOverflow="visible"
        verticalAlign="start"
      >
        {teamEditor ? (
          <div className="space-y-4">
            <FormField label="Team name" htmlFor={teamNameInputId} optional>
              <input
                id={teamNameInputId}
                type="text"
                className="app-input"
                value={teamEditor.name}
                onChange={(event) =>
                  setTeamEditor((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                }
              />
            </FormField>
            <div role="group" aria-label="Team members" className="space-y-3">
              <p className="app-label">Team members (up to {teamSize})</p>
              {teamEditor.members.map((memberRow, index) => (
                <div key={memberRow.key} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <FormField label={`Member ${index + 1}`} htmlFor={`${teamNameInputId}-member-${index}`}>
                    <MemberAutocomplete
                      inputId={`${teamNameInputId}-member-${index}`}
                      value={memberRow.memberId}
                      onChange={(next) =>
                        setTeamEditor((prev) =>
                          prev
                            ? {
                                ...prev,
                                members: prev.members.map((item) =>
                                  item.key === memberRow.key ? { ...item, memberId: next, pendingName: '' } : item,
                                ),
                              }
                            : prev,
                        )
                      }
                    />
                  </FormField>
                  <FormField
                    label="Or name (not yet a member)"
                    htmlFor={`${teamNameInputId}-pending-${index}`}
                  >
                    <input
                      id={`${teamNameInputId}-pending-${index}`}
                      type="text"
                      className="app-input"
                      value={memberRow.pendingName}
                      disabled={memberRow.memberId !== ''}
                      onChange={(event) =>
                        setTeamEditor((prev) =>
                          prev
                            ? {
                                ...prev,
                                members: prev.members.map((item) =>
                                  item.key === memberRow.key ? { ...item, pendingName: event.target.value } : item,
                                ),
                              }
                            : prev,
                        )
                      }
                    />
                  </FormField>
                  <div className="flex items-end pb-1">
                    <Button
                      type="button"
                      variant="outline-danger"
                     
                      onClick={() =>
                        setTeamEditor((prev) =>
                          prev
                            ? { ...prev, members: prev.members.filter((item) => item.key !== memberRow.key) }
                            : prev,
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              {teamEditor.members.length < teamSize ? (
                <Button
                  type="button"
                  variant="secondary"
                 
                  onClick={() =>
                    setTeamEditor((prev) =>
                      prev ? { ...prev, members: [...prev.members, emptyTeamEditorMember(prev.members.length)] } : prev,
                    )
                  }
                >
                  Add teammate
                </Button>
              ) : null}
            </div>
            <FormField label="Notes" htmlFor={teamNotesInputId} optional helperText="Audit note for team changes.">
              <textarea
                id={teamNotesInputId}
                className="app-input min-h-20"
                value={teamEditor.notes}
                onChange={(event) =>
                  setTeamEditor((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                }
              />
            </FormField>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setTeamEditor(null)}>
                Cancel
              </Button>
              <Button type="button" disabled={teamSaving} onClick={() => void saveTeamEditor()}>
                {teamEditor.teamId == null ? 'Create team' : 'Save team'}
              </Button>
            </div>
          </div>
        ) : (
          <div />
        )}
      </Modal>

      <Modal
        isOpen={linkTarget != null}
        onClose={() => setLinkTarget(null)}
        title="Link teammate to member account"
        contentOverflow="visible"
      >
        {linkTarget ? (
          <div className="space-y-4">
            {(() => {
              const pendingRows = linkTarget.team.members.filter((member) => member.pendingName);
              const selectedPending =
                pendingRows.find((member) => member.id === linkTarget.pendingRowId) ?? pendingRows[0];
              return (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Link <span className="font-medium">{selectedPending?.pendingName}</span> on{' '}
                    {teamDisplayName(linkTarget.team)} to their member account. Their TLINE points will count toward
                    the team total.
                  </p>
                  {pendingRows.length > 1 ? (
                    <FormField label="Teammate to link" htmlFor={`${linkMemberInputId}-pending`} required>
                      <ChoiceInput<number>
                        inputId={`${linkMemberInputId}-pending`}
                        value={linkTarget.pendingRowId}
                        onChange={(next) => {
                          if (typeof next !== 'number') return;
                          setLinkTarget((prev) => (prev ? { ...prev, pendingRowId: next } : prev));
                        }}
                        options={pendingRows.map((member) => ({
                          value: member.id,
                          label: member.pendingName ?? `Teammate #${member.id}`,
                        }))}
                        listboxLabel="Teammate to link"
                      />
                    </FormField>
                  ) : null}
                </>
              );
            })()}
            <FormField label="Member" htmlFor={linkMemberInputId} required>
              <MemberAutocomplete inputId={linkMemberInputId} value={linkMemberId} onChange={setLinkMemberId} />
            </FormField>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setLinkTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={linkSaving || linkMemberId === ''}
                onClick={() => void saveLinkMember()}
              >
                Link member
              </Button>
            </div>
          </div>
        ) : (
          <div />
        )}
      </Modal>
    </div>
  );
}
