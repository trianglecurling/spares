import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useState } from 'react';
import Button from '../../components/Button';
import Layout from '../../components/Layout';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import Modal from '../../components/Modal';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api from '../../utils/api';
import {
  deserializeCommitteeContactInfo,
  serializeCommitteeContactInfo,
} from '../../utils/governanceContactInfo';
import {
  GovernanceCommittee,
  GovernanceBoardMember,
  GovernanceOfficerPosition,
  GovernanceSummaryResponse,
  OFFICER_LABELS,
} from '../../types/governance';
import ChoiceInput from '../../components/ChoiceInput';

const OFFICER_POSITIONS: GovernanceOfficerPosition[] = ['president', 'vice_president', 'treasurer', 'secretary'];

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

function daysInMonth(month: string): number {
  const m = Number.parseInt(month, 10);
  if ([1, 3, 5, 7, 8, 10, 12].includes(m)) return 31;
  if ([4, 6, 9, 11].includes(m)) return 30;
  return 29;
}

const selectClass =
  'app-input';
const inputClass =
  'app-input';
const labelClass = 'app-label';

function splitOfficerAssignments(
  data: GovernanceSummaryResponse | null
): Record<GovernanceOfficerPosition, number | ''> {
  return {
    president: data?.officers.find((o) => o.position === 'president')?.boardMemberId ?? '',
    vice_president: data?.officers.find((o) => o.position === 'vice_president')?.boardMemberId ?? '',
    treasurer: data?.officers.find((o) => o.position === 'treasurer')?.boardMemberId ?? '',
    secretary: data?.officers.find((o) => o.position === 'secretary')?.boardMemberId ?? '',
  };
}

function formatCommitteeContactSummary(contactInfo: string | null): string {
  const parsed = deserializeCommitteeContactInfo(contactInfo);
  const sections: string[] = [];
  if (parsed.emails.length > 0) sections.push(`Emails: ${parsed.emails.join(', ')}`);
  if (parsed.slackChannels.length > 0) sections.push(`Slack: ${parsed.slackChannels.join(', ')}`);
  if (parsed.note) sections.push(parsed.note);
  return sections.join(' | ') || 'None';
}

function MonthDaySelect({
  label,
  month,
  day,
  onMonthChange,
  onDayChange,
}: {
  label: string;
  month: string;
  day: string;
  onMonthChange: (value: string) => void;
  onDayChange: (value: string) => void;
}) {
  const monthPickerId = useId();
  const dayPickerId = useId();
  const maxDay = daysInMonth(month);
  const days = Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0'));
  const dayOptions = days.map((d) => ({
    value: d,
    label: String(parseInt(d, 10)),
  }));
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex gap-2">
        <ChoiceInput<string>
          inputId={monthPickerId}
          options={MONTHS.map((m) => ({ value: m.value, label: m.label }))}
          value={month}
          onChange={(next) => {
            if (next != null && !Array.isArray(next)) onMonthChange(next);
          }}
          listboxLabel={`${label} month`}
          inputClassName={selectClass}
        />
        <ChoiceInput<string>
          inputId={dayPickerId}
          options={dayOptions}
          value={day}
          onChange={(next) => {
            if (next != null && !Array.isArray(next)) onDayChange(next);
          }}
          listboxLabel={`${label} day`}
          inputClassName={`${selectClass} max-w-[80px]`}
        />
      </div>
    </div>
  );
}

function TokenInput({
  label,
  tokens,
  onChange,
  placeholder,
  normalize = (v) => v,
}: {
  label: string;
  tokens: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  normalize?: (value: string) => string;
}) {
  const [draft, setDraft] = useState('');
  const inputId = useId();

  const pushToken = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft('');
      return;
    }
    const next = normalize(trimmed);
    if (!next || tokens.includes(next)) {
      setDraft('');
      return;
    }
    onChange([...tokens, next]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      pushToken();
    }
  };

  return (
    <div>
      <label htmlFor={inputId} className={labelClass}>
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 min-h-[38px]">
        {tokens.map((token) => (
          <span
            key={token}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 text-xs text-gray-700 dark:text-gray-200"
          >
            {token}
            <button
              type="button"
              onClick={() => onChange(tokens.filter((t) => t !== token))}
              className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-100"
              aria-label={`Remove ${token}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={pushToken}
          placeholder={tokens.length === 0 ? placeholder : ''}
          className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Press Enter or comma to add.</p>
    </div>
  );
}

export default function AdminGovernance() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [data, setData] = useState<GovernanceSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Global settings
  const [settingsMonth, setSettingsMonth] = useState('09');
  const [settingsDay, setSettingsDay] = useState('01');
  const [turnoverMonth, setTurnoverMonth] = useState('09');
  const [turnoverDay, setTurnoverDay] = useState('01');
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);

  const [showInactiveBoardMembers, setShowInactiveBoardMembers] = useState(false);

  // Add board member
  const [isAddBoardMemberOpen, setIsAddBoardMemberOpen] = useState(false);
  const [newBoardMemberId, setNewBoardMemberId] = useState<number | ''>('');
  const [newBoardPublicEmail, setNewBoardPublicEmail] = useState('');
  const [newBoardFirstYear, setNewBoardFirstYear] = useState('');
  const [newBoardLastYear, setNewBoardLastYear] = useState('');

  // Edit board member
  const [boardMemberEditor, setBoardMemberEditor] = useState<GovernanceBoardMember | null>(null);
  const [bmEditorFirstYear, setBmEditorFirstYear] = useState('');
  const [bmEditorLastYear, setBmEditorLastYear] = useState('');
  const [bmEditorEmail, setBmEditorEmail] = useState('');
  const [bmEditorManualInactive, setBmEditorManualInactive] = useState(false);

  // Officers
  const [officerAssignments, setOfficerAssignments] = useState<Record<GovernanceOfficerPosition, number | ''>>({
    president: '',
    vice_president: '',
    treasurer: '',
    secretary: '',
  });

  // Add committee (modal)
  const [isAddCommitteeOpen, setIsAddCommitteeOpen] = useState(false);
  const [newCommitteeName, setNewCommitteeName] = useState('');
  const [newCommitteeLiaisonId, setNewCommitteeLiaisonId] = useState<number | ''>('');
  const [newCommitteeEmails, setNewCommitteeEmails] = useState<string[]>([]);
  const [newCommitteeSlackChannels, setNewCommitteeSlackChannels] = useState<string[]>([]);
  const [newCommitteeNote, setNewCommitteeNote] = useState('');
  const [newCommitteeResponsibilities, setNewCommitteeResponsibilities] = useState('');

  // Edit committee
  const [committeeEditor, setCommitteeEditor] = useState<GovernanceCommittee | null>(null);
  const [cmEditorName, setCmEditorName] = useState('');
  const [cmEditorLiaisonId, setCmEditorLiaisonId] = useState<number | ''>('');
  const [cmEditorResponsibilities, setCmEditorResponsibilities] = useState('');
  const [cmEditorEmails, setCmEditorEmails] = useState<string[]>([]);
  const [cmEditorSlackChannels, setCmEditorSlackChannels] = useState<string[]>([]);
  const [cmEditorNote, setCmEditorNote] = useState('');

  // Add chair
  const [newChairMemberIds, setNewChairMemberIds] = useState<Record<number, number | ''>>({});
  const [newChairPublicEmails, setNewChairPublicEmails] = useState<Record<number, string>>({});

  // Edit chair email
  const [chairEmailEditor, setChairEmailEditor] = useState<{
    committeeId: number;
    chairId: number;
    memberName: string;
    email: string;
  } | null>(null);

  const boardMemberOptions = useMemo(
    () =>
      (data?.boardMembers ?? []).map((bm) => ({
        id: bm.id,
        label: `${bm.memberName} (${bm.firstFiscalYear}–${bm.lastFiscalYear})${bm.manualInactive ? ' [inactive]' : ''}`,
      })),
    [data?.boardMembers]
  );
  const activeBoardMemberOptions = useMemo(
    () =>
      (data?.boardMembers ?? [])
        .filter((bm) => bm.isActive)
        .map((bm) => ({
          id: bm.id,
          label: bm.memberName,
        })),
    [data?.boardMembers]
  );

  const sortedBoardMembers = useMemo(() => {
    const all = [...(data?.boardMembers ?? [])];
    all.sort((a, b) => {
      if (a.lastFiscalYear !== b.lastFiscalYear) return a.lastFiscalYear - b.lastFiscalYear;
      return a.memberName.localeCompare(b.memberName);
    });
    return all;
  }, [data?.boardMembers]);

  const visibleBoardMembers = useMemo(
    () => (showInactiveBoardMembers ? sortedBoardMembers : sortedBoardMembers.filter((bm) => bm.isActive)),
    [sortedBoardMembers, showInactiveBoardMembers]
  );

  const inactiveCount = useMemo(
    () => sortedBoardMembers.filter((bm) => !bm.isActive).length,
    [sortedBoardMembers]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const governanceResponse = await api.get<GovernanceSummaryResponse>('/governance');
      setData(governanceResponse.data);
      const mmFiscal = governanceResponse.data.settings.fiscalYearStartMmdd.split('-');
      setSettingsMonth(mmFiscal[0] ?? '09');
      setSettingsDay(mmFiscal[1] ?? '01');
      const mmTurnover = governanceResponse.data.settings.boardTurnoverMmdd.split('-');
      setTurnoverMonth(mmTurnover[0] ?? '09');
      setTurnoverDay(mmTurnover[1] ?? '01');
      setOfficerAssignments(splitOfficerAssignments(governanceResponse.data));
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'response' in err
          ? String((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Unable to load admin governance.')
          : 'Unable to load admin governance.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const runUpdate = async (action: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'response' in err
          ? String((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Request failed.')
          : 'Request failed.';
      setError(message);
      showAlert(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Board member CRUD
  const resetAddBoardMemberForm = () => {
    setNewBoardMemberId('');
    setNewBoardPublicEmail('');
    setNewBoardFirstYear('');
    setNewBoardLastYear('');
    setIsAddBoardMemberOpen(false);
  };

  const handleCreateBoardMember = (event: FormEvent) => {
    event.preventDefault();
    if (newBoardMemberId === '' || !newBoardFirstYear || !newBoardLastYear) return;
    void runUpdate(async () => {
      await api.post('/governance/board-members', {
        memberId: newBoardMemberId,
        publicEmail: newBoardPublicEmail.trim() || null,
        firstFiscalYear: Number.parseInt(newBoardFirstYear, 10),
        lastFiscalYear: Number.parseInt(newBoardLastYear, 10),
      });
      resetAddBoardMemberForm();
    });
  };

  const openBoardMemberEditor = (bm: GovernanceBoardMember) => {
    setBoardMemberEditor(bm);
    setBmEditorFirstYear(String(bm.firstFiscalYear));
    setBmEditorLastYear(String(bm.lastFiscalYear));
    setBmEditorEmail(bm.publicEmail ?? '');
    setBmEditorManualInactive(bm.manualInactive);
  };

  const closeBoardMemberEditor = () => {
    setBoardMemberEditor(null);
  };

  const saveBoardMemberEditor = () => {
    if (!boardMemberEditor || !bmEditorFirstYear || !bmEditorLastYear) return;
    void runUpdate(async () => {
      await api.patch(`/governance/board-members/${boardMemberEditor.id}`, {
        firstFiscalYear: Number.parseInt(bmEditorFirstYear, 10),
        lastFiscalYear: Number.parseInt(bmEditorLastYear, 10),
        publicEmail: bmEditorEmail.trim() || null,
        manualInactive: bmEditorManualInactive,
      });
      closeBoardMemberEditor();
    });
  };

  const removeBoardMemberFromEditor = async () => {
    if (!boardMemberEditor) return;
    const confirmed = await confirm({
      title: 'Remove board member',
      message:
        'Are you sure you want to remove this board member? Consider marking them as inactive instead.',
      variant: 'warning',
      confirmText: 'Remove',
    });
    if (!confirmed) return;
    void runUpdate(async () => {
      await api.delete(`/governance/board-members/${boardMemberEditor.id}`);
      closeBoardMemberEditor();
    });
  };

  // Officers
  const hasOfficerChanges = useMemo(() => {
    if (!data) return false;
    const current = splitOfficerAssignments(data);
    return OFFICER_POSITIONS.some((p) => current[p] !== officerAssignments[p]);
  }, [data, officerAssignments]);

  const saveOfficerAssignments = () => {
    if (!data) return;
    const current = splitOfficerAssignments(data);
    void runUpdate(async () => {
      for (const position of OFFICER_POSITIONS) {
        const next = officerAssignments[position];
        const prev = current[position];
        if (next === prev) continue;
        if (next === '') {
          await api.delete(`/governance/officers/${position}`);
        } else {
          await api.put(`/governance/officers/${position}`, { boardMemberId: next });
        }
      }
    });
  };

  // Committee CRUD
  const handleCreateCommittee = (event: FormEvent) => {
    event.preventDefault();
    if (!newCommitteeName.trim()) return;
    void runUpdate(async () => {
      await api.post('/governance/committees', {
        name: newCommitteeName.trim(),
        boardLiaisonBoardMemberId: newCommitteeLiaisonId === '' ? null : newCommitteeLiaisonId,
        contactInfo: serializeCommitteeContactInfo({
          emails: newCommitteeEmails,
          slackChannels: newCommitteeSlackChannels,
          note: newCommitteeNote.trim() || null,
        }),
        responsibilities: newCommitteeResponsibilities.trim() || null,
      });
      resetAddCommitteeForm();
    });
  };

  const resetAddCommitteeForm = () => {
    setNewCommitteeName('');
    setNewCommitteeLiaisonId('');
    setNewCommitteeEmails([]);
    setNewCommitteeSlackChannels([]);
    setNewCommitteeNote('');
    setNewCommitteeResponsibilities('');
    setIsAddCommitteeOpen(false);
  };

  const openCommitteeEditor = (c: GovernanceCommittee) => {
    const parsed = deserializeCommitteeContactInfo(c.contactInfo);
    setCommitteeEditor(c);
    setCmEditorName(c.name);
    setCmEditorLiaisonId(c.boardLiaisonBoardMemberId ?? '');
    setCmEditorResponsibilities(c.responsibilities ?? '');
    setCmEditorEmails(parsed.emails);
    setCmEditorSlackChannels(parsed.slackChannels);
    setCmEditorNote(parsed.note ?? '');
  };

  const closeCommitteeEditor = () => setCommitteeEditor(null);

  const saveCommitteeEditor = () => {
    if (!committeeEditor || !cmEditorName.trim()) return;
    void runUpdate(async () => {
      await api.patch(`/governance/committees/${committeeEditor.id}`, {
        name: cmEditorName.trim(),
        boardLiaisonBoardMemberId: cmEditorLiaisonId === '' ? null : cmEditorLiaisonId,
        contactInfo: serializeCommitteeContactInfo({
          emails: cmEditorEmails,
          slackChannels: cmEditorSlackChannels,
          note: cmEditorNote.trim() || null,
        }),
        responsibilities: cmEditorResponsibilities.trim() || null,
      });
      closeCommitteeEditor();
    });
  };

  // Chair
  const handleAddChair = (committee: GovernanceCommittee) => {
    const memberId = newChairMemberIds[committee.id];
    if (!memberId) return;
    void runUpdate(async () => {
      await api.post(`/governance/committees/${committee.id}/chairs`, {
        memberId,
        publicEmail: (newChairPublicEmails[committee.id] ?? '').trim() || null,
      });
      setNewChairMemberIds((prev) => ({ ...prev, [committee.id]: '' }));
      setNewChairPublicEmails((prev) => ({ ...prev, [committee.id]: '' }));
    });
  };

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Manage governance"
          description="Configure board membership, officers, committees, chairs, and governance calendar settings."
        />
        {error && <p className="app-alert-error">{error}</p>}

        {loading ? (
          <div className="app-card text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : (
          <>
            {/* Board Members */}
            <section className="app-card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="app-section-title">Board members</h2>
                <Button onClick={() => setIsAddBoardMemberOpen(true)}>Add board member</Button>
              </div>

              <div className="space-y-1">
                {sortedBoardMembers.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No board members configured.</p>
                )}
                {visibleBoardMembers.map((bm) => (
                  <div
                    key={bm.id}
                    className={`rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 flex items-center justify-between gap-2${
                      !bm.isActive ? ' opacity-60' : ''
                    }`}
                  >
                    <div className="text-sm text-gray-700 dark:text-gray-300 min-w-0">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{bm.memberName}</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {' '}&middot; {bm.firstFiscalYear}–{bm.lastFiscalYear}
                        {bm.effectivePublicEmail ? ` · ${bm.effectivePublicEmail}` : ''}
                        {!bm.isActive && (
                          <span className="ml-1 text-gray-400 dark:text-gray-500">
                            (inactive{bm.manualInactive ? ', manual' : ''})
                          </span>
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openBoardMemberEditor(bm)}
                      disabled={saving}
                      className="shrink-0 text-sm text-primary-teal hover:underline disabled:opacity-50"
                    >
                      Edit
                    </button>
                  </div>
                ))}
                {inactiveCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowInactiveBoardMembers((prev) => !prev)}
                    className="mt-1 text-sm text-primary-teal hover:underline"
                  >
                    {showInactiveBoardMembers
                      ? 'Hide inactive members'
                      : `Show ${inactiveCount} inactive member${inactiveCount === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            </section>

            {/* Officers */}
            <section className="app-card space-y-4">
              <h2 className="app-section-title">Officers</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {OFFICER_POSITIONS.map((position) => {
                  const currentName =
                    data?.boardMembers.find(
                      (bm) => bm.id === (data?.officers.find((o) => o.position === position)?.boardMemberId)
                    )?.memberName ?? null;
                  return (
                    <div key={position}>
                      <label className={labelClass}>
                        {OFFICER_LABELS[position]}
                        {currentName && (
                          <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
                            — currently {currentName}
                          </span>
                        )}
                      </label>
                      <ChoiceInput<number>
                        options={activeBoardMemberOptions.map((o) => ({
                          value: o.id,
                          label: o.label,
                        }))}
                        value={officerAssignments[position] === '' ? null : officerAssignments[position]}
                        onChange={(next) =>
                          setOfficerAssignments((prev) => ({
                            ...prev,
                            [position]:
                              next == null || Array.isArray(next) ? '' : next,
                          }))
                        }
                        placeholder="Unassigned"
                        listboxLabel={OFFICER_LABELS[position]}
                        disabled={saving}
                        inputClassName={selectClass}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <Button onClick={saveOfficerAssignments} disabled={saving || !hasOfficerChanges}>
                  Save officers
                </Button>
              </div>
            </section>

            {/* Committees */}
            <section className="app-card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="app-section-title">Committees</h2>
                <Button onClick={() => setIsAddCommitteeOpen(true)}>Add committee</Button>
              </div>

              <div className="space-y-3">
                {(data?.committees ?? []).length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No committees configured.</p>
                )}
                {(data?.committees ?? []).map((committee) => (
                  <article
                    key={committee.id}
                    className="rounded-md border border-gray-200 dark:border-gray-700 p-4 space-y-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-0.5">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{committee.name}</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          Liaison:{' '}
                          {data?.boardMembers.find((bm) => bm.id === committee.boardLiaisonBoardMemberId)
                            ?.memberName ?? 'None'}
                        </p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          Contact: {formatCommitteeContactSummary(committee.contactInfo)}
                        </p>
                        {committee.responsibilities && (
                          <p className="text-sm text-gray-700 dark:text-gray-300">
                            Responsibilities: {committee.responsibilities}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => openCommitteeEditor(committee)}
                          disabled={saving}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={async () => {
                            const confirmed = await confirm({
                              title: 'Delete committee',
                              message: `Delete "${committee.name}"? This cannot be undone.`,
                              variant: 'danger',
                              confirmText: 'Delete',
                            });
                            if (!confirmed) return;
                            void runUpdate(async () => {
                              await api.delete(`/governance/committees/${committee.id}`);
                            });
                          }}
                          disabled={saving}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    {/* Add chair */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                      <div>
                        <label className={labelClass}>Add chair</label>
                        <MemberAutocomplete
                          value={newChairMemberIds[committee.id] ?? ''}
                          onChange={(next) =>
                            setNewChairMemberIds((prev) => ({ ...prev, [committee.id]: next }))
                          }
                          placeholder="Search members..."
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Chair public email</label>
                        <input
                          value={newChairPublicEmails[committee.id] ?? ''}
                          onChange={(e) =>
                            setNewChairPublicEmails((prev) => ({
                              ...prev,
                              [committee.id]: e.target.value,
                            }))
                          }
                          className={inputClass}
                          placeholder="optional"
                        />
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => handleAddChair(committee)}
                        disabled={saving || !newChairMemberIds[committee.id]}
                      >
                        Add chair
                      </Button>
                    </div>

                    {/* Chair list */}
                    {committee.chairs.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">No chairs assigned.</p>
                    ) : (
                      <div className="space-y-1">
                        {committee.chairs.map((chair) => (
                          <div
                            key={chair.id}
                            className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded border border-gray-200 dark:border-gray-700 px-3 py-2"
                          >
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {chair.memberName}{' '}
                              <span className="text-gray-500 dark:text-gray-400">
                                ({chair.effectivePublicEmail ?? 'no public email'})
                              </span>
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setChairEmailEditor({
                                    committeeId: committee.id,
                                    chairId: chair.id,
                                    memberName: chair.memberName,
                                    email: chair.publicEmail ?? '',
                                  })
                                }
                                disabled={saving}
                                className="text-sm text-primary-teal hover:underline"
                              >
                                Edit email
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void runUpdate(async () => {
                                    await api.delete(
                                      `/governance/committees/${committee.id}/chairs/${chair.id}`
                                    );
                                  })
                                }
                                disabled={saving}
                                className="text-sm text-red-600 dark:text-red-400 hover:underline"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsSettingsDialogOpen(true)}
                className="text-sm text-primary-teal underline underline-offset-2 hover:text-primary-teal/80"
              >
                Edit global settings
              </button>
            </div>
          </>
        )}
      </AppPage>

      {/* Add board member dialog */}
      <Modal isOpen={isAddBoardMemberOpen} onClose={resetAddBoardMemberForm} title="Add board member">
        <form className="space-y-4" onSubmit={handleCreateBoardMember}>
          <div>
            <label className={labelClass}>
              Member <span className="text-red-500">*</span>
            </label>
            <MemberAutocomplete
              value={newBoardMemberId}
              onChange={setNewBoardMemberId}
              placeholder="Search members..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>
                First fiscal year <span className="text-red-500">*</span>
              </label>
              <input
                value={newBoardFirstYear}
                onChange={(e) => setNewBoardFirstYear(e.target.value)}
                className={inputClass}
                placeholder="2026"
              />
            </div>
            <div>
              <label className={labelClass}>
                Last fiscal year <span className="text-red-500">*</span>
              </label>
              <input
                value={newBoardLastYear}
                onChange={(e) => setNewBoardLastYear(e.target.value)}
                className={inputClass}
                placeholder="2028"
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Public email</label>
            <input
              value={newBoardPublicEmail}
              onChange={(e) => setNewBoardPublicEmail(e.target.value)}
              className={inputClass}
              placeholder="optional"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={resetAddBoardMemberForm}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || newBoardMemberId === '' || !newBoardFirstYear || !newBoardLastYear}>
              {saving ? 'Adding...' : 'Add board member'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Global settings dialog */}
      <Modal isOpen={isSettingsDialogOpen} onClose={() => setIsSettingsDialogOpen(false)} title="Global settings">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void runUpdate(async () => {
              await api.put('/governance/settings', {
                fiscalYearStartMmdd: `${settingsMonth}-${settingsDay}`,
                boardTurnoverMmdd: `${turnoverMonth}-${turnoverDay}`,
              });
              setIsSettingsDialogOpen(false);
            });
          }}
        >
          <MonthDaySelect
            label="Fiscal year start"
            month={settingsMonth}
            day={settingsDay}
            onMonthChange={(m) => {
              setSettingsMonth(m);
              const max = daysInMonth(m);
              if (Number.parseInt(settingsDay, 10) > max) setSettingsDay(String(max).padStart(2, '0'));
            }}
            onDayChange={setSettingsDay}
          />
          <MonthDaySelect
            label="Board turnover date"
            month={turnoverMonth}
            day={turnoverDay}
            onMonthChange={(m) => {
              setTurnoverMonth(m);
              const max = daysInMonth(m);
              if (Number.parseInt(turnoverDay, 10) > max) setTurnoverDay(String(max).padStart(2, '0'));
            }}
            onDayChange={setTurnoverDay}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setIsSettingsDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit board member dialog */}
      <Modal isOpen={Boolean(boardMemberEditor)} onClose={closeBoardMemberEditor} title={`Edit board member — ${boardMemberEditor?.memberName ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveBoardMemberEditor();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>First fiscal year</label>
              <input
                value={bmEditorFirstYear}
                onChange={(e) => setBmEditorFirstYear(e.target.value)}
                className={inputClass}
                placeholder="2026"
              />
            </div>
            <div>
              <label className={labelClass}>Last fiscal year</label>
              <input
                value={bmEditorLastYear}
                onChange={(e) => setBmEditorLastYear(e.target.value)}
                className={inputClass}
                placeholder="2028"
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Public email</label>
            <input
              value={bmEditorEmail}
              onChange={(e) => setBmEditorEmail(e.target.value)}
              className={inputClass}
              placeholder="optional"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="bm-manual-inactive"
              checked={bmEditorManualInactive}
              onChange={(e) => setBmEditorManualInactive(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
            />
            <label htmlFor="bm-manual-inactive" className="text-sm text-gray-700 dark:text-gray-300">
              Mark as inactive
            </label>
          </div>
          <div className="flex justify-between gap-2 pt-2">
            <Button type="button" variant="danger" onClick={() => void removeBoardMemberFromEditor()} disabled={saving}>
              Remove
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={closeBoardMemberEditor}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Add committee dialog */}
      <Modal isOpen={isAddCommitteeOpen} onClose={resetAddCommitteeForm} title="Add committee">
        <form className="space-y-4" onSubmit={handleCreateCommittee}>
          <div>
            <label className={labelClass}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              value={newCommitteeName}
              onChange={(e) => setNewCommitteeName(e.target.value)}
              className={inputClass}
              placeholder="Competition"
              required
            />
          </div>
          <div>
            <label className={labelClass}>Liaison</label>
            <ChoiceInput<number>
              options={boardMemberOptions.map((o) => ({ value: o.id, label: o.label }))}
              value={newCommitteeLiaisonId === '' ? null : newCommitteeLiaisonId}
              onChange={(next) =>
                setNewCommitteeLiaisonId(
                  next == null || Array.isArray(next) ? '' : next
                )
              }
              placeholder="None"
              listboxLabel="Liaison"
              inputClassName={selectClass}
            />
          </div>
          <TokenInput
            label="Contact emails"
            tokens={newCommitteeEmails}
            onChange={setNewCommitteeEmails}
            placeholder="committee@example.com"
            normalize={(v) => v.toLowerCase()}
          />
          <TokenInput
            label="Slack channels"
            tokens={newCommitteeSlackChannels}
            onChange={setNewCommitteeSlackChannels}
            placeholder="#competition"
            normalize={(v) => (v.startsWith('#') ? v : `#${v}`)}
          />
          <div>
            <label className={labelClass}>Additional contact note</label>
            <input
              value={newCommitteeNote}
              onChange={(e) => setNewCommitteeNote(e.target.value)}
              className={inputClass}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className={labelClass}>Responsibilities</label>
            <textarea
              value={newCommitteeResponsibilities}
              onChange={(e) => setNewCommitteeResponsibilities(e.target.value)}
              className={inputClass + ' min-h-[80px]'}
              placeholder="Short description"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={resetAddCommitteeForm}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !newCommitteeName.trim()}>
              {saving ? 'Adding...' : 'Add committee'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit committee dialog */}
      <Modal isOpen={Boolean(committeeEditor)} onClose={closeCommitteeEditor} title={`Edit committee — ${committeeEditor?.name ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveCommitteeEditor();
          }}
        >
          <div>
            <label className={labelClass}>Name</label>
            <input value={cmEditorName} onChange={(e) => setCmEditorName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Liaison</label>
            <ChoiceInput<number>
              options={boardMemberOptions.map((o) => ({ value: o.id, label: o.label }))}
              value={cmEditorLiaisonId === '' ? null : cmEditorLiaisonId}
              onChange={(next) =>
                setCmEditorLiaisonId(next == null || Array.isArray(next) ? '' : next)
              }
              placeholder="None"
              listboxLabel="Liaison"
              inputClassName={selectClass}
            />
          </div>
          <TokenInput
            label="Contact emails"
            tokens={cmEditorEmails}
            onChange={setCmEditorEmails}
            placeholder="committee@example.com"
            normalize={(v) => v.toLowerCase()}
          />
          <TokenInput
            label="Slack channels"
            tokens={cmEditorSlackChannels}
            onChange={setCmEditorSlackChannels}
            placeholder="#committee-channel"
            normalize={(v) => (v.startsWith('#') ? v : `#${v}`)}
          />
          <div>
            <label className={labelClass}>Additional contact note</label>
            <input value={cmEditorNote} onChange={(e) => setCmEditorNote(e.target.value)} className={inputClass} placeholder="Optional" />
          </div>
          <div>
            <label className={labelClass}>Responsibilities</label>
            <textarea
              value={cmEditorResponsibilities}
              onChange={(e) => setCmEditorResponsibilities(e.target.value)}
              className={inputClass + ' min-h-[80px]'}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={closeCommitteeEditor}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit chair email dialog */}
      <Modal
        isOpen={Boolean(chairEmailEditor)}
        onClose={() => setChairEmailEditor(null)}
        title={`Edit chair email — ${chairEmailEditor?.memberName ?? ''}`}
        size="sm"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chairEmailEditor) return;
            void runUpdate(async () => {
              await api.patch(
                `/governance/committees/${chairEmailEditor.committeeId}/chairs/${chairEmailEditor.chairId}`,
                { publicEmail: chairEmailEditor.email.trim() || null }
              );
              setChairEmailEditor(null);
            });
          }}
        >
          <div>
            <label className={labelClass}>Public email</label>
            <input
              value={chairEmailEditor?.email ?? ''}
              onChange={(e) =>
                setChairEmailEditor((prev) => (prev ? { ...prev, email: e.target.value } : null))
              }
              className={inputClass}
              placeholder="Leave blank to use member email"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setChairEmailEditor(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
