import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import MarkdownDescriptionEditor, {
  type MarkdownDescriptionEditorRef,
} from '../../components/MarkdownDescriptionEditor';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import Modal from '../../components/Modal';
import PageTabs from '../../components/PageTabs';
import RecurrenceFields, { useRecurrenceState } from '../../components/RecurrenceFields';
import IncludeArchivedToggle from '../../components/softDelete/IncludeArchivedToggle';
import VolunteerProgramLocationField from '../../components/VolunteerProgramLocationField';
import VolunteerSignupDialog, {
  type VolunteerSignupTarget,
} from '../../components/volunteering/VolunteerSignupDialog';
import AttachCalendarEventField from '../../components/volunteering/AttachCalendarEventField';
import { resolveSiteName } from '../../components/SeoMeta';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useSiteBranding } from '../../hooks/useSiteBranding';
import api, { formatApiError } from '../../utils/api';
import { memberCanManageCredentials } from '../../utils/credentialAccess';
import { memberHasScope } from '../../utils/permissions';
import { getWeekdayFromDate } from '../calendarEventFormShared';
import { formatPhone } from '../../utils/phone';
import {
  addMinutesToDateTimeLocal,
  formatDurationMinutes,
  formatAttachedCalendarEventWhen,
  formatVolunteerDayHeading,
  formatVolunteerRange,
  fromDateTimeLocal,
  hoursInputToMinutes,
  minutesToHoursInput,
  toDateTimeLocal,
  VOLUNTEER_LOCATION_CLUB,
  volunteerLocationChoiceFromStored,
  volunteerLocationStoredFromChoice,
  volunteerShiftDayKey,
  volunteerShiftHasEnded,
  defaultVolunteerCreditHours,
  parseVolunteerSignupKind,
  volunteerHoursFromRange,
  volunteerProgramUiTerms,
  VOLUNTEER_CREDIT_HOURS_STEP,
  maxVolunteerCreditHoursOnStep,
  snapVolunteerCreditHours,
  type VolunteerAttachedCalendarEvent,
  type VolunteerLocationChoice,
  type VolunteerProgramUiTerms,
  type VolunteerProgramView,
  type VolunteerRoleView,
  type VolunteerShiftView,
  type VolunteerSignupKind,
  type VolunteerSignupView,
} from '../../utils/volunteering';

type TabKey = 'settings' | 'description' | 'roles' | 'shifts' | 'signups';
const secondaryTabs = ['description', 'roles', 'shifts', 'signups'] as const;
const createTabs = ['description', 'roles', 'shifts'] as const;

type DraftRecurringShift = {
  key: string;
  startDt: string;
  endDt: string;
  creditHours: number;
  roleId: number;
  volunteersNeeded: number;
  recurrence: { rrule: string; endDate?: string; count?: number };
  previewCount: number;
};

type DraftCalendarSyncedShift = {
  key: string;
  roleId: number;
  volunteersNeeded: number;
  creditHours: number;
  previewCount: number;
};

type ShiftAddSource = 'calendar' | 'manual';
type NewShiftCreditMode = 'shift-length' | 'custom';

type DraftShiftRole = { roleId: number; volunteersNeeded: number };

type NewShiftTimeRow = {
  key: string;
  startLocal: string;
  endLocal: string;
  endManuallyEdited: boolean;
};

type UploadedFile = { id: number; publicUrl: string };

/** Skip values that would break mailto/BCC lists. */
const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmailAddress(email: string): boolean {
  return EMAIL_ADDRESS_RE.test(email);
}

function volunteerSignupContactEmail(signup: VolunteerSignupView): string {
  return (signup.memberEmail || signup.guestEmail || '').trim();
}

function buildVolunteerSignupEmailEntries(
  shifts: VolunteerShiftView[],
  roleIds: number[]
): string[] {
  const roleSet = new Set(roleIds);
  const entries: string[] = [];
  const seenEmails = new Set<string>();
  for (const shift of shifts) {
    for (const role of shift.roles) {
      if (!roleSet.has(role.roleId)) continue;
      for (const signup of role.signups) {
        const email = volunteerSignupContactEmail(signup);
        if (!email || !isValidEmailAddress(email)) continue;
        const emailKey = email.toLowerCase();
        if (seenEmails.has(emailKey)) continue;
        seenEmails.add(emailKey);
        const displayName = signup.memberName.trim() || email;
        entries.push(`"${displayName}" <${email}>`);
      }
    }
  }
  return entries;
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function nextVolunteerProgramImageFilename(programSlug: string, markdown: string, mimeType: string): string {
  const safeSlug =
    (programSlug || 'volunteer-program')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'volunteer-program';
  const pattern = new RegExp(`${safeSlug}-image-(\\d{3})\\.[a-z0-9]+`, 'gi');
  let highest = 0;
  let match = pattern.exec(markdown);
  while (match) {
    const current = Number.parseInt(match[1] ?? '0', 10);
    if (Number.isFinite(current)) highest = Math.max(highest, current);
    match = pattern.exec(markdown);
  }
  const next = String(highest + 1).padStart(3, '0');
  return `${safeSlug}-image-${next}.${extensionFromMimeType(mimeType)}`;
}

function createEmptyTimeRow(): NewShiftTimeRow {
  return {
    key: `shift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startLocal: '',
    endLocal: '',
    endManuallyEdited: false,
  };
}

function nextDraftId(counter: { current: number }): number {
  const id = counter.current;
  counter.current -= 1;
  return id;
}

function buildDraftShiftRoles(
  shiftId: number,
  assignments: DraftShiftRole[],
  roles: VolunteerRoleView[]
): VolunteerShiftView['roles'] {
  return assignments.map((assignment, index) => {
    const role = roles.find((item) => item.id === assignment.roleId);
    return {
      id: shiftId * 100 - index,
      shiftId,
      roleId: assignment.roleId,
      roleName: role?.name || `Role ${assignment.roleId}`,
      roleDescription: role?.description ?? null,
      volunteersNeeded: assignment.volunteersNeeded,
      volunteersRegistered: 0,
      isFull: false,
      requiredCredentials: role?.requiredCredentials ?? [],
      callerHasCredentials: true,
      callerIsSignedUp: false,
      signups: [],
    };
  });
}

export default function AdminVolunteerProgramEditor() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNew =
    location.pathname === '/admin/signups/new' ||
    location.pathname.startsWith('/admin/signups/new/');
  const navigate = useNavigate();
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { branding } = useSiteBranding();
  const { resolvedTheme } = useTheme();
  const clubName = resolveSiteName(branding?.clubName);
  const baseId = useId();
  const descriptionEditorRef = useRef<MarkdownDescriptionEditorRef>(null);
  const descriptionLabelId = `${baseId}-description-label`;
  const canCreate =
    memberHasScope(member, 'volunteering.manage') || Boolean(member?.isServerAdmin);
  const canManageCredentials = memberCanManageCredentials(member);

  const allowedTabs = isNew ? createTabs : secondaryTabs;
  const activeTab: TabKey =
    tab && (allowedTabs as readonly string[]).includes(tab) ? (tab as TabKey) : 'settings';
  const draftIdCounter = useRef(-1);

  const [saving, setSaving] = useState(false);
  const [program, setProgram] = useState<VolunteerProgramView | null>(null);
  const [includeArchivedSignups, setIncludeArchivedSignups] = useState(false);
  const [allCredentials, setAllCredentials] = useState<Array<{ id: number; name: string }>>([]);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  /** Slug persisted in the database — used for public URLs, not the editable slug field. */
  const [savedSlug, setSavedSlug] = useState('');
  const [pointOfContact, setPointOfContact] = useState('');
  const [locationChoice, setLocationChoice] = useState<VolunteerLocationChoice>(VOLUNTEER_LOCATION_CLUB);
  const [published, setPublished] = useState(false);
  const [featureOnDashboard, setFeatureOnDashboard] = useState(true);
  const [publicSignups, setPublicSignups] = useState(false);
  const [signupKind, setSignupKind] = useState<VolunteerSignupKind>(() =>
    parseVolunteerSignupKind(searchParams.get('kind'))
  );
  const [kindChosen, setKindChosen] = useState(() => !isNew);
  const [managerIds, setManagerIds] = useState<number[]>([]);
  const [draftDescription, setDraftDescription] = useState('');
  const [draftRoles, setDraftRoles] = useState<VolunteerRoleView[]>([]);
  const [draftShifts, setDraftShifts] = useState<VolunteerShiftView[]>([]);
  const [draftRecurringShifts, setDraftRecurringShifts] = useState<DraftRecurringShift[]>([]);
  const [draftCalendarSyncedShifts, setDraftCalendarSyncedShifts] = useState<DraftCalendarSyncedShift[]>(
    []
  );
  const [attachedCalendarEvent, setAttachedCalendarEvent] =
    useState<VolunteerAttachedCalendarEvent | null>(null);
  const [shiftAddSource, setShiftAddSource] = useState<ShiftAddSource>('manual');

  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [roleDurationHours, setRoleDurationHours] = useState('3');
  const [roleCredentialIds, setRoleCredentialIds] = useState<number[]>([]);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);

  const [newShiftRoleId, setNewShiftRoleId] = useState<number | null>(null);
  const [newShiftTimes, setNewShiftTimes] = useState<NewShiftTimeRow[]>([createEmptyTimeRow()]);
  const [newShiftNeeded, setNewShiftNeeded] = useState(1);
  const [newShiftCreditHours, setNewShiftCreditHours] = useState('');
  const [newShiftCreditMode, setNewShiftCreditMode] = useState<NewShiftCreditMode>('shift-length');
  const [newShiftAssignCredit, setNewShiftAssignCredit] = useState(false);
  const [savingShift, setSavingShift] = useState(false);
  const [recurringMode, setRecurringMode] = useState(false);
  const [deleteShiftTarget, setDeleteShiftTarget] = useState<VolunteerShiftView | null>(null);
  const [deletingShift, setDeletingShift] = useState(false);
  const [signupTarget, setSignupTarget] = useState<VolunteerSignupTarget | null>(null);
  const [copyEmailsDialogOpen, setCopyEmailsDialogOpen] = useState(false);
  const [copyEmailRoleIds, setCopyEmailRoleIds] = useState<number[]>([]);
  const copyEmailRolesLabelId = `${baseId}-copy-email-roles`;

  const loadProgram = useCallback(async () => {
    if (isNew || !id) return;
    try {
      const res = await api.get(`/volunteering/admin/programs/${id}`);
      const data = res.data as VolunteerProgramView;
      setProgram(data);
      setTitle(data.title);
      setSlug(data.slug || '');
      setSavedSlug(data.slug || '');
      setPointOfContact(data.pointOfContact);
      // API already nulls club-default locations; clubName only matters for legacy raw values.
      setLocationChoice(volunteerLocationChoiceFromStored(data.location, clubName));
      setPublished(Boolean(data.published));
      setFeatureOnDashboard(data.featureOnDashboard !== false);
      setPublicSignups(Boolean(data.publicSignups));
      setSignupKind(parseVolunteerSignupKind(data.signupKind));
      setKindChosen(true);
      setManagerIds(data.managers.map((m) => m.id));
      setAttachedCalendarEvent(data.calendarEvent ?? null);
      setShiftAddSource(data.calendarEvent ? 'calendar' : 'manual');
      setNewShiftRoleId((prev) => {
        if (prev && data.roles.some((r) => r.id === prev)) return prev;
        return data.roles[0]?.id ?? null;
      });
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load program'), 'error');
      navigate('/admin/volunteering');
    }
    // clubName intentionally omitted: only seeds the location radio; including it would refetch on branding load.
  }, [id, isNew, navigate, showAlert]);

  useEffect(() => {
    if (isNew) {
      setProgram(null);
      setAttachedCalendarEvent(null);
      setShiftAddSource('manual');
      return;
    }
    // Drop stale program when switching to a different program id (same mounted route).
    setProgram((prev) => (prev && String(prev.id) === String(id) ? prev : null));
    void loadProgram();
  }, [loadProgram, id, isNew]);

  useEffect(() => {
    if (isNew && !canCreate) {
      showAlert('You do not have permission to create volunteer programs.', 'error');
      navigate('/admin/volunteering');
    }
  }, [isNew, canCreate, navigate, showAlert]);

  useEffect(() => {
    api
      .get('/volunteering/admin/credential-options')
      .then((res) => {
        const list = (res.data?.credentials || []) as Array<{ id: number; name: string }>;
        setAllCredentials(list.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {
        // Ignore 403 for program-only managers.
      });
  }, []);

  const workingRoles = isNew ? draftRoles : program?.roles || [];
  const workingShifts = isNew ? draftShifts : program?.shifts || [];

  const selectedRoleForShift = useMemo(
    () => workingRoles.find((r) => r.id === newShiftRoleId) ?? null,
    [workingRoles, newShiftRoleId]
  );
  const visibleSignupShifts = useMemo(() => {
    if (!program) return [];
    if (includeArchivedSignups) return program.shifts;
    const nowIso = new Date().toISOString();
    return program.shifts.filter((shift) => !volunteerShiftHasEnded(shift.endDt, nowIso));
  }, [program, includeArchivedSignups]);
  const copyEmailRoleOptions = useMemo(
    (): ChoiceOption<number>[] =>
      workingRoles.map((role) => ({ value: role.id, label: role.name })),
    [workingRoles]
  );
  const newShiftStartLocal = newShiftTimes[0]?.startLocal ?? '';
  const newShiftDurationHours = useMemo(() => {
    if (shiftAddSource === 'calendar' && attachedCalendarEvent) {
      return volunteerHoursFromRange(attachedCalendarEvent.start, attachedCalendarEvent.end);
    }
    const complete = newShiftTimes.filter((row) => row.startLocal && row.endLocal);
    if (complete.length === 0) return 0;
    return Math.min(
      ...complete.map((row) =>
        volunteerHoursFromRange(fromDateTimeLocal(row.startLocal), fromDateTimeLocal(row.endLocal))
      )
    );
  }, [attachedCalendarEvent, newShiftTimes, shiftAddSource]);
  const newShiftCreditMax = maxVolunteerCreditHoursOnStep(newShiftDurationHours);
  const newShiftRecurrence = useRecurrenceState(
    '',
    newShiftStartLocal.slice(0, 10),
    { fallbackPreset: 'weekly' }
  );

  useEffect(() => {
    if (!attachedCalendarEvent) {
      setShiftAddSource('manual');
      return;
    }
    if (attachedCalendarEvent.occurrenceCount != null) return;
    let canceled = false;
    api
      .get<VolunteerAttachedCalendarEvent>(
        `/volunteering/admin/direct-calendar-events/${attachedCalendarEvent.id}`
      )
      .then((res) => {
        if (canceled || !res.data) return;
        setAttachedCalendarEvent((current) =>
          current && current.id === res.data.id ? { ...current, ...res.data } : current
        );
      })
      .catch(() => {
        // Preview count is optional; create still expands on the server.
      });
    return () => {
      canceled = true;
    };
  }, [attachedCalendarEvent?.id, attachedCalendarEvent?.occurrenceCount]);

  const updateTimeRowEndFromRole = useCallback(
    (rowKey: string, startLocal: string, role: VolunteerRoleView | null | undefined) => {
      if (!startLocal || !role) return;
      const endLocal = addMinutesToDateTimeLocal(startLocal, role.defaultDurationMinutes || 180);
      setNewShiftTimes((prev) =>
        prev.map((row) =>
          row.key === rowKey ? { ...row, startLocal, endLocal, endManuallyEdited: false } : row
        )
      );
    },
    []
  );

  useEffect(() => {
    if (!selectedRoleForShift) return;
    setNewShiftTimes((prev) =>
      prev.map((row) => {
        if (row.endManuallyEdited || !row.startLocal) return row;
        return {
          ...row,
          endLocal: addMinutesToDateTimeLocal(
            row.startLocal,
            selectedRoleForShift.defaultDurationMinutes || 180
          ),
        };
      })
    );
  }, [selectedRoleForShift]);

  const credentialOptions: ChoiceOption<number>[] = useMemo(
    () => allCredentials.map((c) => ({ value: c.id, label: c.name })),
    [allCredentials]
  );

  const roleOptions: ChoiceOption<number>[] = useMemo(
    () => workingRoles.map((r) => ({ value: r.id, label: r.name })),
    [workingRoles]
  );

  const programsListTo =
    signupKind === 'general' ? '/admin/volunteering/general' : '/admin/volunteering';
  const terms = volunteerProgramUiTerms(signupKind);

  const newProgramTabTo = (tabKey: TabKey) => {
    const params = new URLSearchParams(searchParams);
    params.set('kind', signupKind);
    const path = tabKey === 'settings' ? '/admin/signups/new' : `/admin/signups/new/${tabKey}`;
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };

  const flushDraftDescription = () => {
    const markdown = descriptionEditorRef.current?.getMarkdown?.();
    if (markdown != null) setDraftDescription(markdown);
    return markdown ?? draftDescription;
  };

  const handleCreateProgram = async () => {
    if (locationChoice === null) {
      showAlert('Enter a custom location, or choose the club', 'error');
      navigate(newProgramTabTo('settings'));
      return;
    }
    if (!title.trim() || !pointOfContact.trim()) {
      showAlert('Title and point of contact are required.', 'warning');
      navigate(newProgramTabTo('settings'));
      return;
    }
    const description = flushDraftDescription();
    setSaving(true);
    try {
      const created = await api.post('/volunteering/admin/programs', {
        title: title.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || null,
        pointOfContact: pointOfContact.trim(),
        location: volunteerLocationStoredFromChoice(locationChoice, clubName),
        published,
        featureOnDashboard: signupKind === 'volunteering' ? featureOnDashboard : false,
        publicSignups,
        signupKind,
        managerIds,
        calendarEventId: attachedCalendarEvent?.id ?? null,
      });
      const programId = created.data.id as number;
      const roleIdMap = new Map<number, number>();
      try {
        for (const role of draftRoles) {
          const savedRole = await api.post(`/volunteering/admin/programs/${programId}/roles`, {
            name: role.name,
            description: role.description,
            defaultDurationMinutes: role.defaultDurationMinutes,
            requiredCredentialIds: role.requiredCredentials.map((credential) => credential.id),
          });
          roleIdMap.set(role.id, savedRole.data.id as number);
        }
        const mapShiftRoles = (roles: DraftShiftRole[]) =>
          roles.map((role) => {
            const roleId = roleIdMap.get(role.roleId);
            if (roleId == null) {
              throw new Error(`A ${terms.shiftSingular} is missing its ${terms.roleSingular}`);
            }
            return { roleId, volunteersNeeded: role.volunteersNeeded };
          });
        if (draftShifts.length > 0) {
          await api.post(`/volunteering/admin/programs/${programId}/shifts/bulk`, {
            shifts: draftShifts.map((shift) => ({
              startDt: shift.startDt,
              endDt: shift.endDt,
              creditHours: shift.creditHours,
              roles: mapShiftRoles(
                shift.roles.map((role) => ({
                  roleId: role.roleId,
                  volunteersNeeded: role.volunteersNeeded,
                }))
              ),
            })),
          });
        }
        for (const batch of draftRecurringShifts) {
          const roleId = roleIdMap.get(batch.roleId);
          if (roleId == null) {
            throw new Error(`A recurring ${terms.shiftSingular} is missing its ${terms.roleSingular}`);
          }
          await api.post(`/volunteering/admin/programs/${programId}/shifts/bulk`, {
            shifts: [
              {
                startDt: batch.startDt,
                endDt: batch.endDt,
                creditHours: batch.creditHours,
                roles: [{ roleId, volunteersNeeded: batch.volunteersNeeded }],
              },
            ],
            recurrence: batch.recurrence,
          });
        }
        for (const batch of draftCalendarSyncedShifts) {
          const roleId = roleIdMap.get(batch.roleId);
          if (roleId == null) {
            throw new Error(`A calendar ${terms.shiftSingular} is missing its ${terms.roleSingular}`);
          }
          await api.post(`/volunteering/admin/programs/${programId}/shifts/from-calendar-event`, {
            roleId,
            volunteersNeeded: batch.volunteersNeeded,
            creditHours: batch.creditHours,
          });
        }
      } catch (err) {
        showAlert(
          formatApiError(
            err,
            `Program created, but some ${terms.rolePlural} or ${terms.shiftPlural} could not be saved. Finish them on the program page.`
          ),
          'warning'
        );
        navigate(`/admin/volunteering/${programId}`);
        return;
      }
      showAlert('Program created', 'success');
      navigate(`/admin/volunteering/${programId}`);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to create program'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNew) {
      await handleCreateProgram();
      return;
    }
    if (locationChoice === null) {
      showAlert('Enter a custom location, or choose the club', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        pointOfContact: pointOfContact.trim(),
        location: volunteerLocationStoredFromChoice(locationChoice, clubName),
        published,
        featureOnDashboard: signupKind === 'volunteering' ? featureOnDashboard : false,
        publicSignups,
        signupKind,
        managerIds,
        calendarEventId: attachedCalendarEvent?.id ?? null,
      };
      const res = await api.patch(`/volunteering/admin/programs/${id}`, payload);
      const nextSlug = (res.data as VolunteerProgramView)?.slug || savedSlug;
      setSavedSlug(nextSlug);
      setSlug(nextSlug);
      showAlert('Program saved', 'success');
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save program'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNew || !id) return;
    const markdown = descriptionEditorRef.current?.getMarkdown?.() ?? program?.description ?? '';
    setSaving(true);
    try {
      const res = await api.patch(`/volunteering/admin/programs/${id}`, {
        description: markdown.trim() || null,
      });
      setProgram(res.data as VolunteerProgramView);
      showAlert('Description saved', 'success');
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save description'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadMarkdownImage = async (
    blob: Blob
  ): Promise<{ url: string; altText?: string } | null> => {
    const mimeType = blob.type || 'image/png';
    if (!mimeType.startsWith('image/')) {
      showAlert('Only image paste is supported', 'error');
      return null;
    }
    const currentMarkdown = descriptionEditorRef.current?.getMarkdown?.() ?? program?.description ?? '';
    const filename = nextVolunteerProgramImageFilename(
      savedSlug || slug || program?.slug || 'volunteer-program',
      currentMarkdown,
      mimeType
    );
    const file = new File([blob], filename, { type: mimeType });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('displayName', filename);
    formData.append('visibility', 'public');
    try {
      const res = await api.post<UploadedFile[]>('/content/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const uploaded = Array.isArray(res.data) ? res.data[0] : null;
      if (!uploaded?.publicUrl) {
        showAlert('Image uploaded, but URL was missing', 'error');
        return null;
      }
      return { url: uploaded.publicUrl, altText: program?.title.trim() || 'Image' };
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to upload image'), 'error');
      return null;
    }
  };

  const resetRoleForm = () => {
    setEditingRoleId(null);
    setRoleName('');
    setRoleDescription('');
    setRoleDurationHours('3');
    setRoleCredentialIds([]);
  };

  const startEditRole = (role: VolunteerRoleView) => {
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setRoleDescription(role.description || '');
    setRoleDurationHours(minutesToHoursInput(role.defaultDurationMinutes || 180));
    setRoleCredentialIds(role.requiredCredentials.map((c) => c.id));
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const minutes = hoursInputToMinutes(roleDurationHours);
    if (minutes == null) {
      showAlert('Enter a valid default duration in hours (for example 3 or 2.5).', 'warning');
      return;
    }
    if (!roleName.trim()) {
      showAlert(`${terms.roleTitle} name is required.`, 'warning');
      return;
    }
    const requiredCredentials = allCredentials
      .filter((credential) => roleCredentialIds.includes(credential.id))
      .map((credential) => ({
        id: credential.id,
        name: credential.name,
        description: null,
        pointOfContactEmail: '',
      }));
    if (isNew) {
      const saved: VolunteerRoleView = {
        id: editingRoleId ?? nextDraftId(draftIdCounter),
        programId: 0,
        name: roleName.trim(),
        description: roleDescription.trim() || null,
        defaultDurationMinutes: minutes,
        requiredCredentials,
      };
      setDraftRoles((prev) => {
        if (editingRoleId) {
          return prev.map((role) => (role.id === editingRoleId ? saved : role));
        }
        return [...prev, saved];
      });
      if (editingRoleId) {
        setDraftShifts((prev) =>
          prev.map((shift) => ({
            ...shift,
            roles: shift.roles.map((role) =>
              role.roleId === editingRoleId
                ? {
                    ...role,
                    roleName: saved.name,
                    roleDescription: saved.description,
                    requiredCredentials: saved.requiredCredentials,
                  }
                : role
            ),
          }))
        );
      } else if (!newShiftRoleId) {
        setNewShiftRoleId(saved.id);
      }
      resetRoleForm();
      return;
    }
    if (!id) return;
    setSaving(true);
    try {
      const payload = {
        name: roleName.trim(),
        description: roleDescription.trim() || null,
        defaultDurationMinutes: minutes,
        requiredCredentialIds: roleCredentialIds,
      };
      if (editingRoleId) {
        await api.patch(`/volunteering/admin/roles/${editingRoleId}`, payload);
        showAlert(`${terms.roleTitle} updated`, 'success');
      } else {
        await api.post(`/volunteering/admin/programs/${id}/roles`, payload);
        showAlert(`${terms.roleTitle} created`, 'success');
      }
      resetRoleForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, `Failed to save ${terms.roleSingular}`), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (role: VolunteerRoleView) => {
    if (isNew) {
      setDraftRoles((prev) => prev.filter((item) => item.id !== role.id));
      setDraftShifts((prev) =>
        prev
          .map((shift) => ({
            ...shift,
            roles: shift.roles.filter((item) => item.roleId !== role.id),
          }))
          .filter((shift) => shift.roles.length > 0)
      );
      setDraftRecurringShifts((prev) => prev.filter((item) => item.roleId !== role.id));
      setDraftCalendarSyncedShifts((prev) => prev.filter((item) => item.roleId !== role.id));
      if (editingRoleId === role.id) resetRoleForm();
      if (newShiftRoleId === role.id) {
        setNewShiftRoleId(draftRoles.find((item) => item.id !== role.id)?.id ?? null);
      }
      return;
    }
    const ok = await confirm({
      title: `Delete ${terms.roleSingular}`,
      message: `Delete ${terms.roleSingular} "${role.name}"? ${terms.shiftTab} using this ${terms.roleSingular} will lose that assignment.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/roles/${role.id}`);
      showAlert(`${terms.roleTitle} deleted`, 'success');
      if (editingRoleId === role.id) resetRoleForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, `Failed to delete ${terms.roleSingular}`), 'error');
    }
  };

  const resetNewShiftForm = () => {
    setNewShiftTimes([createEmptyTimeRow()]);
    setNewShiftNeeded(1);
    setNewShiftCreditHours('');
    setNewShiftCreditMode('shift-length');
    setNewShiftAssignCredit(false);
    setRecurringMode(false);
  };

  const addAdditionalShiftTime = () => {
    setNewShiftTimes((prev) => {
      const last = prev[prev.length - 1];
      if (last?.endLocal) {
        const startLocal = last.endLocal;
        const durationMinutes =
          selectedRoleForShift?.defaultDurationMinutes || 180;
        return [
          ...prev,
          {
            key: `shift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            startLocal,
            endLocal: addMinutesToDateTimeLocal(startLocal, durationMinutes),
            endManuallyEdited: false,
          },
        ];
      }
      return [
        ...prev,
        createEmptyTimeRow(),
      ];
    });
  };

  const resolveNewShiftCreditHours = ():
    | { creditHours: number | undefined }
    | { error: string } => {
    if (signupKind === 'general') {
      if (!newShiftAssignCredit) return { creditHours: 0 };
      const parsed = Number.parseFloat(newShiftCreditHours);
      if (newShiftCreditHours.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
        return { error: 'Enter volunteer credit hours.' };
      }
      return { creditHours: snapVolunteerCreditHours(parsed, newShiftDurationHours) };
    }
    if (newShiftCreditMode !== 'custom') {
      return { creditHours: undefined };
    }
    const parsed = Number.parseFloat(newShiftCreditHours);
    if (newShiftCreditHours.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      return { error: 'Enter volunteer credit hours.' };
    }
    if (newShiftDurationHours > 0 && parsed > newShiftDurationHours + 1e-9) {
      return { error: `Volunteer credit hours cannot exceed the ${terms.shiftSingular} length.` };
    }
    return { creditHours: snapVolunteerCreditHours(parsed, newShiftDurationHours) };
  };

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShiftRoleId) return;
    if (shiftAddSource === 'calendar') {
      if (!attachedCalendarEvent) {
        showAlert('Attach a calendar event on the Settings tab first.', 'warning');
        return;
      }
      const creditResult = resolveNewShiftCreditHours();
      if ('error' in creditResult) {
        showAlert(creditResult.error, 'warning');
        return;
      }
      const { creditHours } = creditResult;
      const previewCount = attachedCalendarEvent.occurrenceCount ?? 1;
      if (isNew) {
        setDraftCalendarSyncedShifts((prev) => [
          ...prev,
          {
            key: `calendar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            roleId: newShiftRoleId,
            volunteersNeeded: newShiftNeeded,
            creditHours:
              creditHours ??
              defaultVolunteerCreditHours(
                signupKind,
                attachedCalendarEvent.start,
                attachedCalendarEvent.end
              ),
            previewCount,
          },
        ]);
        showAlert(
          previewCount === 1
            ? `${terms.shiftTitle} added`
            : `${previewCount} ${terms.shiftPlural} will be created from the calendar event`,
          'success'
        );
        resetNewShiftForm();
        return;
      }
      setSavingShift(true);
      try {
        const result = await api.post(`/volunteering/admin/programs/${id}/shifts/from-calendar-event`, {
          roleId: newShiftRoleId,
          volunteersNeeded: newShiftNeeded,
          creditHours,
        });
        const count = result.data?.shiftIds?.length ?? previewCount;
        showAlert(
          count === 1 ? `${terms.shiftTitle} created` : `${count} ${terms.shiftPlural} created`,
          'success'
        );
        resetNewShiftForm();
        await loadProgram();
      } catch (err) {
        showAlert(formatApiError(err, `Failed to create ${terms.shiftPlural}`), 'error');
      } finally {
        setSavingShift(false);
      }
      return;
    }
    const incomplete = newShiftTimes.some((row) => !row.startLocal || !row.endLocal);
    if (incomplete) {
      showAlert(`Choose a start and end time for every ${terms.shiftSingular}.`, 'warning');
      return;
    }
    if (recurringMode) {
      if (!newShiftRecurrence.payload) {
        showAlert('Choose a recurrence pattern.', 'warning');
        return;
      }
      if (!newShiftRecurrence.endDate && newShiftRecurrence.count === '') {
        showAlert(`Recurring ${terms.shiftPlural} need an end date or a count.`, 'warning');
        return;
      }
    }
    const creditResult = resolveNewShiftCreditHours();
    if ('error' in creditResult) {
      showAlert(creditResult.error, 'warning');
      return;
    }
    const { creditHours } = creditResult;
    const selectedRole = workingRoles.find((role) => role.id === newShiftRoleId) ?? null;

    if (isNew) {
      if (recurringMode) {
        const recurrence = newShiftRecurrence.payload;
        if (!recurrence) return;
        setDraftRecurringShifts((prev) => [
          ...prev,
          {
            key: `recurring-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            startDt: fromDateTimeLocal(newShiftTimes[0].startLocal),
            endDt: fromDateTimeLocal(newShiftTimes[0].endLocal),
            creditHours:
              creditHours ??
              defaultVolunteerCreditHours(
                signupKind,
                fromDateTimeLocal(newShiftTimes[0].startLocal),
                fromDateTimeLocal(newShiftTimes[0].endLocal)
              ),
            roleId: newShiftRoleId,
            volunteersNeeded: newShiftNeeded,
            recurrence,
            previewCount: newShiftRecurrence.previewCount ?? 1,
          },
        ]);
        showAlert(
          (newShiftRecurrence.previewCount ?? 1) === 1
            ? `${terms.shiftTitle} added`
            : `${newShiftRecurrence.previewCount} ${terms.shiftPlural} added`,
          'success'
        );
        resetNewShiftForm();
        return;
      }
      const added: VolunteerShiftView[] = newShiftTimes.map((row) => {
        const shiftId = nextDraftId(draftIdCounter);
        const startDt = fromDateTimeLocal(row.startLocal);
        const endDt = fromDateTimeLocal(row.endLocal);
        const hours =
          creditHours ?? defaultVolunteerCreditHours(signupKind, startDt, endDt);
        return {
          id: shiftId,
          programId: 0,
          startDt,
          endDt,
          creditHours: hours,
          recurrenceSeriesId: null,
          recurrenceRule: null,
          recurrenceDate: null,
          sourceCalendarEventId: null,
          roles: buildDraftShiftRoles(
            shiftId,
            [{ roleId: newShiftRoleId, volunteersNeeded: newShiftNeeded }],
            selectedRole ? [selectedRole] : workingRoles
          ),
        };
      });
      setDraftShifts((prev) => [...prev, ...added]);
      showAlert(added.length === 1 ? `${terms.shiftTitle} added` : `${added.length} ${terms.shiftPlural} added`, 'success');
      resetNewShiftForm();
      return;
    }

    if (!id) return;
    setSavingShift(true);
    try {
      const template = {
        startDt: fromDateTimeLocal(newShiftTimes[0].startLocal),
        endDt: fromDateTimeLocal(newShiftTimes[0].endLocal),
        creditHours,
        roles: [{ roleId: newShiftRoleId, volunteersNeeded: newShiftNeeded }],
      };
      const result = await api.post(`/volunteering/admin/programs/${id}/shifts/bulk`, recurringMode
        ? { shifts: [template], recurrence: newShiftRecurrence.payload }
        : {
            shifts: newShiftTimes.map((row) => ({
              startDt: fromDateTimeLocal(row.startLocal),
              endDt: fromDateTimeLocal(row.endLocal),
              creditHours:
                creditHours != null
                  ? creditHours
                  : defaultVolunteerCreditHours(
                      signupKind,
                      fromDateTimeLocal(row.startLocal),
                      fromDateTimeLocal(row.endLocal)
                    ),
              roles: [{ roleId: newShiftRoleId, volunteersNeeded: newShiftNeeded }],
            })),
          });
      const count = Array.isArray(result.data?.shiftIds)
        ? result.data.shiftIds.length
        : recurringMode
          ? (newShiftRecurrence.previewCount ?? 1)
          : newShiftTimes.length;
      showAlert(
        count === 1 ? `${terms.shiftTitle} created` : `${count} ${terms.shiftPlural} created`,
        'success'
      );
      resetNewShiftForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, `Failed to create ${terms.shiftPlural}`), 'error');
    } finally {
      setSavingShift(false);
    }
  };

  const handleUpdateExistingShift = async (
    shift: VolunteerShiftView,
    patch: {
      startLocal: string;
      endLocal: string;
      creditHours: number;
      roles: DraftShiftRole[];
      scope: 'this' | 'all';
      recurrence?: { rrule: string; endDate?: string; count?: number } | null;
    }
  ) => {
    if (isNew) {
      const startDt = fromDateTimeLocal(patch.startLocal);
      const endDt = fromDateTimeLocal(patch.endLocal);
      setDraftShifts((prev) =>
        prev.map((item) =>
          item.id === shift.id
            ? {
                ...item,
                startDt,
                endDt,
                creditHours: patch.creditHours,
                roles: buildDraftShiftRoles(item.id, patch.roles, workingRoles),
              }
            : item
        )
      );
      showAlert(`${terms.shiftTitle} updated`, 'success');
      return;
    }
    try {
      await api.patch(`/volunteering/admin/shifts/${shift.id}`, {
        startDt: fromDateTimeLocal(patch.startLocal),
        endDt: fromDateTimeLocal(patch.endLocal),
        creditHours: patch.creditHours,
        roles: patch.roles,
        scope: shift.recurrenceSeriesId != null ? patch.scope : undefined,
        recurrence:
          shift.recurrenceSeriesId != null && patch.scope === 'all' && patch.recurrence
            ? patch.recurrence
            : undefined,
      });
      showAlert(
        shift.recurrenceSeriesId != null && patch.scope === 'all'
          ? `Recurring ${terms.shiftPlural} updated`
          : `${terms.shiftTitle} updated`,
        'success'
      );
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, `Failed to update ${terms.shiftSingular}`), 'error');
    }
  };

  const handleDeleteShift = async (shift: VolunteerShiftView) => {
    if (isNew) {
      setDraftShifts((prev) => prev.filter((item) => item.id !== shift.id));
      return;
    }
    if (shift.recurrenceSeriesId != null) {
      setDeleteShiftTarget(shift);
      return;
    }
    const ok = await confirm({
      title: `Delete ${terms.shiftSingular}`,
      message: `Delete the ${terms.shiftSingular} on ${formatVolunteerRange(shift.startDt, shift.endDt)}? Signups for this ${terms.shiftSingular} will be removed.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/shifts/${shift.id}`);
      showAlert(`${terms.shiftTitle} deleted`, 'success');
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, `Failed to delete ${terms.shiftSingular}`), 'error');
    }
  };

  const confirmDeleteShift = async (scope: 'this' | 'all') => {
    const shift = deleteShiftTarget;
    if (!shift) return;
    setDeletingShift(true);
    try {
      await api.delete(
        `/volunteering/admin/shifts/${shift.id}${scope === 'all' ? '?scope=all' : '?scope=this'}`
      );
      showAlert(scope === 'all' ? `Recurring ${terms.shiftPlural} deleted` : `${terms.shiftTitle} deleted`, 'success');
      setDeleteShiftTarget(null);
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, `Failed to delete ${terms.shiftSingular}`), 'error');
    } finally {
      setDeletingShift(false);
    }
  };

  const openCopyEmailsDialog = () => {
    setCopyEmailRoleIds(program?.roles.map((role) => role.id) ?? []);
    setCopyEmailsDialogOpen(true);
  };

  const handleCopyEmailsFromDialog = async () => {
    if (copyEmailRoleIds.length === 0) {
      showAlert(`Select at least one ${terms.roleSingular}`, 'warning');
      return;
    }
    const entries = buildVolunteerSignupEmailEntries(visibleSignupShifts, copyEmailRoleIds);
    if (entries.length === 0) {
      showAlert('No signup emails to copy', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(entries.join(', '));
      showAlert('Signup emails copied', 'success');
      setCopyEmailsDialogOpen(false);
    } catch {
      showAlert('Failed to copy emails', 'error');
    }
  };

  const handleRemoveSignup = async (signupId: number, memberName: string) => {
    const ok = await confirm({
      title: 'Remove volunteer',
      message: `Remove ${memberName} from this shift?`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/signups/${signupId}`);
      showAlert('Volunteer removed', 'success');
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to remove volunteer'), 'error');
    }
  };

  const tabItems = [
    {
      key: 'settings',
      label: 'Settings',
      isActive: activeTab === 'settings',
      ...(isNew
        ? {
            onClick: () => {
              flushDraftDescription();
              navigate(newProgramTabTo('settings'));
            },
          }
        : { to: `/admin/volunteering/${id}` }),
    },
    {
      key: 'description',
      label: 'Description',
      isActive: activeTab === 'description',
      ...(isNew
        ? {
            onClick: () => {
              flushDraftDescription();
              navigate(newProgramTabTo('description'));
            },
          }
        : { to: `/admin/volunteering/${id}/description` }),
    },
    {
      key: 'roles',
      label: terms.roleTab,
      isActive: activeTab === 'roles',
      ...(isNew
        ? {
            onClick: () => {
              flushDraftDescription();
              navigate(newProgramTabTo('roles'));
            },
          }
        : { to: `/admin/volunteering/${id}/roles` }),
    },
    {
      key: 'shifts',
      label: terms.shiftTab,
      isActive: activeTab === 'shifts',
      ...(isNew
        ? {
            onClick: () => {
              flushDraftDescription();
              navigate(newProgramTabTo('shifts'));
            },
          }
        : { to: `/admin/volunteering/${id}/shifts` }),
    },
    ...(!isNew
      ? [
          {
            key: 'signups',
            label: 'Signups',
            isActive: activeTab === 'signups',
            to: `/admin/volunteering/${id}/signups`,
          },
        ]
      : []),
  ];

  if (!isNew && !program) {
    return (
      <AppPage>
        <AppPageHeader
          title="Edit program"
          actions={<BackButton label="Sign-ups" to="/admin/volunteering" />}
        />
        <AppStateCard title="Loading program..." />
      </AppPage>
    );
  }

  const shiftsByDate = workingShifts.reduce<Record<string, VolunteerShiftView[]>>((acc, shift) => {
    const key = volunteerShiftDayKey(shift.startDt);
    (acc[key] ||= []).push(shift);
    return acc;
  }, {});

  const kindLabelId = `${baseId}-signup-kind`;

  if (isNew && !kindChosen) {
    return (
      <AppPage>
        <AppPageHeader
          title="Create program"
          description="Choose the kind of sign-up before adding details."
          actions={<BackButton label="Sign-ups" to={programsListTo} />}
        />
        <form
          className="max-w-3xl space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            setKindChosen(true);
            setFeatureOnDashboard(signupKind === 'volunteering');
            if (signupKind === 'general') {
              setNewShiftCreditHours('');
              setNewShiftAssignCredit(false);
              setNewShiftCreditMode('shift-length');
            }
            const next = new URLSearchParams(searchParams);
            next.set('kind', signupKind);
            setSearchParams(next, { replace: true });
          }}
        >
          <FormSection title="Sign-up type" surface="panel">
            <FormField
              label="What kind of sign-up is this?"
              labelId={kindLabelId}
              required
            >
              <ChoiceInput<VolunteerSignupKind>
                layout="block"
                ariaLabelledBy={kindLabelId}
                name="signup-kind"
                options={[
                  {
                    value: 'volunteering',
                    label: 'Volunteering sign-up',
                    description:
                      'Club volunteer work. These appear on the Volunteering tab, can be featured on the member dashboard, and grant volunteer credit hours based on the shift length unless you change that.',
                  },
                  {
                    value: 'general',
                    label: 'General sign-up',
                    description:
                      'Other club RSVPs and sign-ups that are not volunteer work. These appear under Other sign-ups, cannot be featured on the dashboard, and do not grant volunteer credit unless you set hours on a time.',
                  },
                ]}
                value={signupKind}
                onChange={(next) => {
                  if (next === 'volunteering' || next === 'general') setSignupKind(next);
                }}
              />
            </FormField>
            <div>
              <Button type="submit">Continue</Button>
            </div>
          </FormSection>
        </form>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={
          isNew
            ? signupKind === 'general'
              ? 'Create general sign-up'
              : 'Create volunteering sign-up'
            : program?.title || 'Edit program'
        }
        description={
          isNew
            ? `Add settings, a description, ${terms.rolePlural}, and ${terms.shiftPlural}, then create the program. You can move between tabs without losing your work.`
            : signupKind === 'general'
              ? 'General sign-up'
              : 'Volunteering sign-up'
        }
        actions={
          <>
            {isNew ? (
              <Button type="button" disabled={saving} onClick={() => void handleCreateProgram()}>
                {saving ? 'Creating…' : 'Create program'}
              </Button>
            ) : null}
            <BackButton label="Sign-ups" to={programsListTo} />
          </>
        }
      />
      <PageTabs items={tabItems} />

      {activeTab === 'settings' ? (
        <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl">
          <FormSection title="Program details" surface="panel">
            {isNew ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {signupKind === 'general' ? 'General sign-up. ' : 'Volunteering sign-up. '}
                <button
                  type="button"
                  className="font-medium text-primary-teal-link hover:underline"
                  onClick={() => {
                    flushDraftDescription();
                    setKindChosen(false);
                  }}
                >
                  Change type
                </button>
              </p>
            ) : null}
            <FormField label="Title" htmlFor={`${baseId}-title`} required>
              <input
                id={`${baseId}-title`}
                className="app-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Slug"
              htmlFor={`${baseId}-slug`}
              helperText="Leave this blank to auto-generate a slug from the title."
            >
              <input
                id={`${baseId}-slug`}
                className="app-input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="auto-generated-from-title"
              />
            </FormField>
            <FormField label="Point of contact" htmlFor={`${baseId}-poc`} required>
              <input
                id={`${baseId}-poc`}
                className="app-input"
                value={pointOfContact}
                onChange={(e) => setPointOfContact(e.target.value)}
                required
              />
            </FormField>
            <VolunteerProgramLocationField
              id={`${baseId}-location`}
              clubName={clubName}
              value={locationChoice}
              onChange={setLocationChoice}
            />
            <FormField label="Managers" htmlFor={`${baseId}-managers`}>
              <MemberMultiSelect
                selectedIds={managerIds}
                onChange={setManagerIds}
                placeholder="Search members to add as managers..."
              />
            </FormField>
            <FormCheckbox
              label="Published"
              checked={published}
              onChange={setPublished}
              helperText={
                signupKind === 'general'
                  ? 'Published programs appear on the Other sign-ups tab.'
                  : 'Published programs appear on the Volunteering tab.'
              }
            />
            {signupKind === 'volunteering' ? (
              <FormCheckbox
                label="Feature on dashboard"
                checked={featureOnDashboard}
                onChange={setFeatureOnDashboard}
                helperText="When enabled, open shifts from this program can appear in the member dashboard opportunities section."
              />
            ) : null}
            <FormCheckbox
              label="Allow public sign-ups"
              checked={publicSignups}
              onChange={setPublicSignups}
              helperText="Anyone with the public program URL can sign up with a name and email. The page is not linked from the site; share the URL directly. Club members who open the URL are sent to the member program page."
            />
            {publicSignups && !isNew && savedSlug ? (
              <FormField
                label="Public sign-up URL"
                htmlFor={`${baseId}-public-url`}
                helperText={
                  published
                    ? 'Share this link for public sign-ups. It only works while the program is published and public sign-ups stay enabled.'
                    : 'Publish the program for this URL to work for the public.'
                }
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    id={`${baseId}-public-url`}
                    className="app-input min-w-0 flex-1"
                    readOnly
                    value={`${window.location.origin}/volunteering/public/programs/${savedSlug}`}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/volunteering/public/programs/${savedSlug}`
                        );
                        showAlert('Public URL copied', 'success');
                      } catch {
                        showAlert('Could not copy URL', 'error');
                      }
                    }}
                  >
                    Copy URL
                  </Button>
                </div>
              </FormField>
            ) : null}
          </FormSection>
          <FormSection
            title="Calendar event"
            surface="panel"
            description="Attach a free-form calendar event so people can open the event and go to this sign-up. If public sign-ups are on, the link also appears on the public calendar."
          >
            <AttachCalendarEventField
              value={attachedCalendarEvent}
              onChange={(next) => {
                setAttachedCalendarEvent(next);
                setShiftAddSource(next ? 'calendar' : 'manual');
              }}
            />
          </FormSection>
          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create program' : 'Save settings'}
            </Button>
          </div>
        </form>
      ) : null}

      {activeTab === 'description' && (program || isNew) ? (
        <form
          onSubmit={handleSaveDescription}
          className="space-y-4"
        >
          <FormField
            label="Description"
            labelId={descriptionLabelId}
            optional
            helperPlacement="after-label"
            helperText={`Shown on Volunteering & sign-ups and program pages. If you do not add ${terms.rolePlural} and ${terms.shiftPlural}, the program still appears as an opportunity with this description.`}
          >
            {({ describedBy }) => (
              <div
                role="group"
                aria-labelledby={descriptionLabelId}
                aria-describedby={describedBy}
                className="flex min-h-[460px] flex-col overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600"
              >
                <MarkdownDescriptionEditor
                  key={isNew ? 'draft' : program?.id}
                  ref={descriptionEditorRef}
                  initialValue={isNew ? draftDescription : (program?.description ?? '')}
                  dark={resolvedTheme === 'dark'}
                  fill
                  includeHiddenContactRecipients
                  enableManagedFileImageEdit
                  onUploadImage={handleUploadMarkdownImage}
                />
              </div>
            )}
          </FormField>
          {isNew ? (
            <div>
              <Button type="button" disabled={saving} onClick={() => void handleCreateProgram()}>
                {saving ? 'Creating…' : 'Create program'}
              </Button>
            </div>
          ) : (
            <div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save description'}
              </Button>
            </div>
          )}
        </form>
      ) : null}

      {activeTab === 'roles' && (program || isNew) ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={handleSaveRole} className="space-y-4">
            <FormSection title={editingRoleId ? `Edit ${terms.roleSingular}` : `Add ${terms.roleSingular}`} surface="panel">
              <FormField label="Name" htmlFor={`${baseId}-role-name`} required>
                <input
                  id={`${baseId}-role-name`}
                  className="app-input"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Description" htmlFor={`${baseId}-role-desc`}>
                <textarea
                  id={`${baseId}-role-desc`}
                  className="app-input min-h-[140px]"
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                />
              </FormField>
              <FormField
                label="Default duration (hours)"
                htmlFor={`${baseId}-role-duration`}
                required
                helperText={`Used to auto-fill ${terms.shiftSingular} end time when this ${terms.roleSingular} is selected.`}
              >
                <input
                  id={`${baseId}-role-duration`}
                  type="number"
                  min={0.25}
                  step={0.25}
                  className="app-input"
                  value={roleDurationHours}
                  onChange={(e) => setRoleDurationHours(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Required credentials" htmlFor={`${baseId}-role-creds`}>
                {credentialOptions.length === 0 ? (
                  <InlineStateMessage
                    title="No credentials defined yet."
                    description={
                      canManageCredentials ? (
                        <Link to="/admin/members/credentials" className="text-primary-teal-link hover:underline">
                          Manage credentials
                        </Link>
                      ) : (
                        `Ask a credential manager to add credentials if a ${terms.roleSingular} should require them.`
                      )
                    }
                  />
                ) : (
                  <ChoiceInput<number>
                    inputId={`${baseId}-role-creds`}
                    maxSelectedItems={null}
                    layout="block"
                    options={credentialOptions}
                    value={roleCredentialIds}
                    onChange={(next) =>
                      setRoleCredentialIds(Array.isArray(next) ? next : next == null ? [] : [next])
                    }
                    placeholder="Select credentials..."
                  />
                )}
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editingRoleId ? `Update ${terms.roleSingular}` : `Add ${terms.roleSingular}`}
                </Button>
                {editingRoleId ? (
                  <Button type="button" variant="secondary" onClick={resetRoleForm}>
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </FormSection>
          </form>

          <div className="space-y-3">
            <h2 className="app-section-title">{terms.roleTab} ({workingRoles.length})</h2>
            {workingRoles.length === 0 ? (
              <InlineStateMessage
                title={
                  signupKind === 'general'
                    ? 'No lists yet. Add the groups people can sign up for, or skip this tab if the description is enough.'
                    : 'No roles yet. Add the jobs volunteers can fill, or skip this tab if the description is enough.'
                }
              />
            ) : (
              workingRoles.map((role) => (
                <div key={role.id} className="app-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{role.name}</div>
                      {role.description ? (
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                          {role.description}
                        </p>
                      ) : null}
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        Default duration: {formatDurationMinutes(role.defaultDurationMinutes || 180)}
                      </p>
                      {role.requiredCredentials.length > 0 ? (
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          Credentials: {role.requiredCredentials.map((c) => c.name).join(', ')}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No credentials required</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button type="button" variant="secondary" onClick={() => startEditRole(role)}>
                        Edit
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => handleDeleteRole(role)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {activeTab === 'shifts' && (program || isNew) ? (
        <div className="space-y-8">
          {workingRoles.length === 0 ? (
            <AppStateCard
              title={`Add ${terms.rolePlural} first`}
              description={`Create at least one ${terms.roleSingular} before adding ${terms.shiftPlural}.`}
              action={
                <Link to={isNew ? newProgramTabTo('roles') : `/admin/volunteering/${id}/roles`}>
                  <Button type="button">Go to {terms.rolePlural}</Button>
                </Link>
              }
            />
          ) : (
            <>
              <form onSubmit={handleCreateShift} className="max-w-3xl">
                <FormSection
                  title={`Add ${terms.shiftSingular}`}
                  surface="panel"
                  description={
                    signupKind === 'general'
                      ? 'A time is a date and window people can sign up for.'
                      : 'A shift specifies a time period for volunteers to work.'
                  }
                >
                  <FormField label={terms.roleTitle} htmlFor={`${baseId}-shift-role`} required>
                    <ChoiceInput<number>
                      inputId={`${baseId}-shift-role`}
                      options={roleOptions}
                      value={newShiftRoleId}
                      onChange={(next) => {
                        setNewShiftRoleId(Array.isArray(next) ? next[0] ?? null : next);
                      }}
                      placeholder={`Select a ${terms.roleSingular}...`}
                    />
                  </FormField>
                  {attachedCalendarEvent ? (
                    <FormField
                      label={`How should this ${terms.shiftSingular} get its time?`}
                      labelId={`${baseId}-shift-source`}
                      required
                    >
                      <ChoiceInput<ShiftAddSource>
                        layout="block"
                        name={`${baseId}-shift-source`}
                        ariaLabelledBy={`${baseId}-shift-source`}
                        options={[
                          {
                            value: 'calendar',
                            label: 'Use calendar event',
                            description: `Match ${attachedCalendarEvent.title} (${formatAttachedCalendarEventWhen(attachedCalendarEvent)}${
                              attachedCalendarEvent.occurrenceCount &&
                              attachedCalendarEvent.occurrenceCount > 1
                                ? ` · ${attachedCalendarEvent.occurrenceCount} ${terms.shiftPlural}`
                                : ''
                            }). Later calendar changes update these ${terms.shiftPlural}.`,
                          },
                          {
                            value: 'manual',
                            label: `Add ${terms.shiftSingular} manually`,
                            description: `Choose start and end times yourself. These ${terms.shiftPlural} stay as you set them.`,
                          },
                        ]}
                        value={shiftAddSource}
                        onChange={(next) => {
                          if (next === 'calendar' || next === 'manual') {
                            setShiftAddSource(next);
                            if (next === 'calendar') setRecurringMode(false);
                          }
                        }}
                      />
                    </FormField>
                  ) : null}

                  {selectedRoleForShift && shiftAddSource === 'manual' ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400 -mt-2 mb-3">
                      Default duration for this {terms.roleSingular}:{' '}
                      {formatDurationMinutes(selectedRoleForShift.defaultDurationMinutes || 180)}
                    </p>
                  ) : null}

                  {shiftAddSource === 'manual' ? (
                  <>
                  <div className="space-y-4">
                    {(recurringMode ? newShiftTimes.slice(0, 1) : newShiftTimes).map((row) => (
                      <div
                        key={row.key}
                        className={
                          newShiftTimes.length > 1
                            ? 'grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-start'
                            : 'grid gap-4 md:grid-cols-2'
                        }
                      >
                        <FormField
                          label="Start"
                          htmlFor={`${baseId}-shift-start-${row.key}`}
                          required
                        >
                          <input
                            id={`${baseId}-shift-start-${row.key}`}
                            type="datetime-local"
                            className="app-input"
                            value={row.startLocal}
                            onChange={(e) => {
                              const start = e.target.value;
                              if (!row.endManuallyEdited && selectedRoleForShift) {
                                updateTimeRowEndFromRole(row.key, start, selectedRoleForShift);
                              } else {
                                setNewShiftTimes((prev) =>
                                  prev.map((r) =>
                                    r.key === row.key ? { ...r, startLocal: start } : r
                                  )
                                );
                              }
                            }}
                            required
                          />
                        </FormField>
                        <FormField
                          label="End"
                          htmlFor={`${baseId}-shift-end-${row.key}`}
                          required
                        >
                          <input
                            id={`${baseId}-shift-end-${row.key}`}
                            type="datetime-local"
                            className="app-input"
                            value={row.endLocal}
                            onChange={(e) => {
                              const endLocal = e.target.value;
                              setNewShiftTimes((prev) =>
                                prev.map((r) =>
                                  r.key === row.key
                                    ? { ...r, endLocal, endManuallyEdited: true }
                                    : r
                                )
                              );
                            }}
                            required
                          />
                        </FormField>
                        {newShiftTimes.length > 1 ? (
                          <div className="space-y-1.5">
                            <div
                              className="mb-1 flex min-h-[1.25rem] items-center"
                              aria-hidden="true"
                            >
                              <span className="text-sm font-medium opacity-0 select-none">
                                End
                              </span>
                            </div>
                            <div className="flex min-h-10 items-center">
                              <button
                                type="button"
                                className="text-sm text-primary-teal-link hover:underline"
                                onClick={() =>
                                  setNewShiftTimes((prev) =>
                                    prev.filter((r) => r.key !== row.key)
                                  )
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {!recurringMode ? (
                      <>
                        <button
                          type="button"
                          className="text-sm font-medium text-primary-teal-link hover:underline"
                          onClick={addAdditionalShiftTime}
                        >
                          Add additional {terms.shiftSingular}
                        </button>
                        {newShiftTimes.length === 1 ? (
                          <>
                            <span className="text-sm text-gray-500 dark:text-gray-400">or</span>
                            <button
                              type="button"
                              className="text-sm font-medium text-primary-teal-link hover:underline"
                              onClick={() => {
                                setNewShiftTimes((prev) => prev.slice(0, 1));
                                const start = newShiftTimes[0]?.startLocal?.slice(0, 10);
                                const d = start ? new Date(`${start}T12:00:00`) : null;
                                newShiftRecurrence.setPreset('weekly');
                                if (d && !Number.isNaN(d.getTime())) {
                                  newShiftRecurrence.setWeekdays([getWeekdayFromDate(d)]);
                                }
                                setRecurringMode(true);
                              }}
                            >
                              Set up recurring {terms.shiftPlural}
                            </button>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="text-sm font-medium text-primary-teal-link hover:underline"
                        onClick={() => setRecurringMode(false)}
                      >
                        Cancel recurrence
                      </button>
                    )}
                  </div>

                  {recurringMode ? (
                    <RecurrenceFields
                      idPrefix={`${baseId}-new-shift`}
                      startDate={newShiftStartLocal.slice(0, 10)}
                      startTime={newShiftStartLocal.slice(11, 16) || '09:00'}
                      allowNone={false}
                      requireLimit
                      state={newShiftRecurrence}
                    />
                  ) : null}
                  </>
                  ) : null}

                  <FormField
                    label={
                      shiftAddSource === 'calendar' || recurringMode || newShiftTimes.length > 1
                        ? `Capacity per ${terms.shiftSingular}`
                        : 'Capacity'
                    }
                    htmlFor={`${baseId}-shift-needed`}
                    required
                  >
                    <input
                      id={`${baseId}-shift-needed`}
                      type="number"
                      min={1}
                      className="app-input w-32"
                      value={newShiftNeeded}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        setNewShiftNeeded(Number.isFinite(n) && n > 0 ? n : 1);
                      }}
                    required
                  />
                  </FormField>
                  {signupKind === 'general' ? (
                    newShiftAssignCredit ? (
                      <FormField
                        label="Volunteer credit hours"
                        htmlFor={`${baseId}-shift-credit`}
                        helperText={
                          newShiftCreditMax > 0
                            ? `0 to ${newShiftCreditMax} hours.`
                            : undefined
                        }
                      >
                        <input
                          id={`${baseId}-shift-credit`}
                          type="number"
                          min={0}
                          max={newShiftCreditMax > 0 ? newShiftCreditMax : undefined}
                          step={VOLUNTEER_CREDIT_HOURS_STEP}
                          className="app-input w-32"
                          value={newShiftCreditHours}
                          onChange={(e) => setNewShiftCreditHours(e.target.value)}
                        />
                      </FormField>
                    ) : (
                      <button
                        type="button"
                        className="text-sm font-medium text-primary-teal-link hover:underline"
                        onClick={() => {
                          setNewShiftAssignCredit(true);
                          setNewShiftCreditHours(
                            newShiftCreditMax > 0 ? String(newShiftCreditMax) : ''
                          );
                        }}
                      >
                        Assign volunteer credit?
                      </button>
                    )
                  ) : (
                    <FormField
                      label="Volunteer credit hours"
                      labelId={`${baseId}-shift-credit`}
                      helperText={
                        newShiftCreditMode === 'custom' && newShiftCreditMax > 0
                          ? `0 to ${newShiftCreditMax} hours.`
                          : undefined
                      }
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <ChoiceInput<NewShiftCreditMode>
                          layout="inline"
                          name={`${baseId}-shift-credit-mode`}
                          ariaLabelledBy={`${baseId}-shift-credit`}
                          options={[
                            { value: 'shift-length', label: 'Use shift length' },
                            { value: 'custom', label: 'Custom' },
                          ]}
                          value={newShiftCreditMode}
                          onChange={(next) => {
                            if (next !== 'shift-length' && next !== 'custom') return;
                            setNewShiftCreditMode(next);
                            if (next === 'custom') {
                              setNewShiftCreditHours(
                                newShiftCreditMax > 0 ? String(newShiftCreditMax) : '0'
                              );
                            }
                          }}
                        />
                        {newShiftCreditMode === 'custom' ? (
                          <input
                            id={`${baseId}-shift-credit-custom`}
                            type="number"
                            min={0}
                            max={newShiftCreditMax > 0 ? newShiftCreditMax : undefined}
                            step={VOLUNTEER_CREDIT_HOURS_STEP}
                            className="app-input w-24"
                            value={newShiftCreditHours}
                            onChange={(e) => setNewShiftCreditHours(e.target.value)}
                            aria-label="Custom volunteer credit hours"
                          />
                        ) : null}
                      </div>
                    </FormField>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={savingShift || !newShiftRoleId}>
                      {savingShift
                        ? 'Saving…'
                        : shiftAddSource === 'calendar' &&
                            (attachedCalendarEvent?.occurrenceCount ?? 1) > 1
                          ? `Add ${terms.shiftPlural}`
                          : recurringMode || newShiftTimes.length > 1
                            ? `Add ${terms.shiftPlural}`
                            : `Add ${terms.shiftSingular}`}
                    </Button>
                  </div>
                </FormSection>
              </form>

              <section className="space-y-4">
                <h2 className="app-section-title">
                  Existing {terms.shiftPlural} ({workingShifts.length + draftRecurringShifts.length + draftCalendarSyncedShifts.length})
                </h2>
                {workingShifts.length === 0 &&
                draftRecurringShifts.length === 0 &&
                draftCalendarSyncedShifts.length === 0 ? (
                  <InlineStateMessage
                    title={isNew ? `No ${terms.shiftPlural} added yet.` : `No ${terms.shiftPlural} saved yet.`}
                  />
                ) : (
                  <>
                    {draftCalendarSyncedShifts.map((batch) => {
                      const roleName =
                        workingRoles.find((role) => role.id === batch.roleId)?.name || terms.roleTitle;
                      return (
                        <div key={batch.key} className="app-card space-y-2 p-4">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            Matches calendar event
                            {batch.previewCount > 1
                              ? ` · ${batch.previewCount} ${terms.shiftPlural}`
                              : ''}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {roleName}
                            {attachedCalendarEvent
                              ? ` · ${formatAttachedCalendarEventWhen(attachedCalendarEvent)}`
                              : ''}
                            {' · '}
                            Capacity {batch.volunteersNeeded}
                          </p>
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                setDraftCalendarSyncedShifts((prev) =>
                                  prev.filter((item) => item.key !== batch.key)
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {draftRecurringShifts.map((batch) => {
                      const roleName =
                        workingRoles.find((role) => role.id === batch.roleId)?.name || terms.roleTitle;
                      return (
                        <div key={batch.key} className="app-card space-y-2 p-4">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            Recurring · {batch.previewCount}{' '}
                            {batch.previewCount === 1 ? terms.shiftSingular : terms.shiftPlural}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {roleName}
                            {' · '}
                            {formatVolunteerRange(batch.startDt, batch.endDt)}
                            {' · '}
                            Capacity {batch.volunteersNeeded}
                          </p>
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                setDraftRecurringShifts((prev) =>
                                  prev.filter((item) => item.key !== batch.key)
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {Object.entries(shiftsByDate)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([dateKey, shifts]) => (
                      <div key={dateKey} className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {formatVolunteerDayHeading(dateKey)}
                        </h3>
                        {shifts.map((shift) => (
                          <ExistingShiftEditor
                            key={shift.id}
                            baseId={`${baseId}-shift-${shift.id}`}
                            shift={shift}
                            roles={workingRoles}
                            terms={terms}
                            onSave={(patch) => handleUpdateExistingShift(shift, patch)}
                            onDelete={() => handleDeleteShift(shift)}
                          />
                        ))}
                      </div>
                    ))}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      ) : null}

      {activeTab === 'signups' && program ? (
        <>
          {program.shifts.length > 0 ? (
            <AppPageControlsRow
              left={
                <IncludeArchivedToggle
                  label={`Include past ${terms.shiftPlural}`}
                  checked={includeArchivedSignups}
                  onChange={setIncludeArchivedSignups}
                />
              }
              right={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={openCopyEmailsDialog}
                  disabled={program.roles.length === 0}
                >
                  Copy emails
                </Button>
              }
            />
          ) : null}
          <div className="space-y-4">
            {program.shifts.length === 0 ? (
              <AppStateCard
                title={`No ${terms.shiftPlural} yet`}
                description={`Add ${terms.shiftPlural} before managing signups.`}
              />
            ) : visibleSignupShifts.length === 0 ? (
              <AppStateCard
                title="No upcoming sign-ups"
                description={`Past ${terms.shiftPlural} are hidden. Include past ${terms.shiftPlural} to review them.`}
              />
            ) : (
              visibleSignupShifts.map((shift) => (
                <div key={shift.id} className="app-card p-4 space-y-3">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {formatVolunteerRange(shift.startDt, shift.endDt)}
                  </div>
                  {shift.roles.map((role) => (
                    <div key={role.id} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">{role.roleName}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            {role.volunteersRegistered}/{role.volunteersNeeded}
                          </div>
                          {!volunteerShiftHasEnded(shift.endDt, new Date().toISOString()) &&
                          role.volunteersRegistered < role.volunteersNeeded ? (
                            <Button
                              type="button"
                              className="!px-3 !py-1.5"
                              onClick={() =>
                                setSignupTarget({
                                  shiftRoleId: role.id,
                                  roleName: role.roleName,
                                  shiftLabel: formatVolunteerRange(shift.startDt, shift.endDt),
                                  remainingSpots: Math.max(
                                    0,
                                    role.volunteersNeeded - role.volunteersRegistered
                                  ),
                                  requiresCredentials: role.requiredCredentials.length > 0,
                                  callerIsSignedUp: role.callerIsSignedUp,
                                  signupKind,
                                  manageForOthers: true,
                                  signedUpMemberIds: role.signups
                                    .map((signup) => signup.memberId)
                                    .filter((id): id is number => id != null),
                                })
                              }
                            >
                              {terms.addPeople}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {role.signups.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No signups</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {role.signups.map((signup) => {
                            const email = volunteerSignupContactEmail(signup);
                            const phone = formatPhone(signup.memberPhone);
                            return (
                              <li key={signup.id} className="text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <span>
                                      {signup.memberName}
                                      {!signup.memberId ? ' (non-member)' : ''}
                                    </span>
                                    {email ? (
                                      <>
                                        <span className="text-gray-400 dark:text-gray-500" aria-hidden="true">
                                          {' · '}
                                        </span>
                                        <span className="text-gray-600 dark:text-gray-400">{email}</span>
                                      </>
                                    ) : null}
                                    {phone ? (
                                      <>
                                        <span className="text-gray-400 dark:text-gray-500" aria-hidden="true">
                                          {' · '}
                                        </span>
                                        <span className="text-gray-600 dark:text-gray-400">{phone}</span>
                                      </>
                                    ) : null}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="shrink-0 !px-3 !py-1.5"
                                    onClick={() => handleRemoveSignup(signup.id, signup.memberName)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                                {signup.comments ? (
                                  <p className="mt-0.5 text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                                    {signup.comments}
                                  </p>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
      <Modal
        isOpen={copyEmailsDialogOpen}
        onClose={() => setCopyEmailsDialogOpen(false)}
        title="Copy emails"
        size="md"
      >
        <div className="space-y-5">
          <FormField
            label={terms.roleTab}
            labelId={copyEmailRolesLabelId}
            helperText="Copies unique emails from sign-ups currently listed on this page."
          >
            {({ describedBy }) => (
              <ChoiceInput<number>
                ariaLabelledBy={copyEmailRolesLabelId}
                ariaDescribedBy={describedBy}
                options={copyEmailRoleOptions}
                value={copyEmailRoleIds}
                onChange={(next) =>
                  setCopyEmailRoleIds(Array.isArray(next) ? next : next != null ? [next] : [])
                }
                layout="block"
                maxSelectedItems={null}
                multiSelectionIndicatorStyle="checkboxes"
                listboxLabel={terms.roleTab}
                name="copy-email-roles"
              />
            )}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCopyEmailsDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleCopyEmailsFromDialog()}>
              Copy
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={!!deleteShiftTarget}
        onClose={() => {
          if (!deletingShift) setDeleteShiftTarget(null);
        }}
        title={`Delete ${terms.shiftSingular}`}
      >
        {deleteShiftTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This is a recurring {terms.shiftSingular}. Delete this instance only, or all remaining instances in
              the series? Signups for deleted {terms.shiftPlural} will be removed.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={deletingShift}
                onClick={() => confirmDeleteShift('this')}
              >
                This instance only
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deletingShift}
                onClick={() => confirmDeleteShift('all')}
              >
                All instances
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={deletingShift}
                onClick={() => setDeleteShiftTarget(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      {signupTarget ? (
        <VolunteerSignupDialog
          target={signupTarget}
          onClose={() => setSignupTarget(null)}
          onSuccess={async (count) => {
            setSignupTarget(null);
            showAlert(
              count === 1
                ? `1 ${terms.peopleSingular} signed up. A confirmation email is on the way.`
                : `${count} ${terms.peoplePlural} signed up. Confirmation emails are on the way.`,
              'success'
            );
            await loadProgram();
          }}
        />
      ) : null}
    </AppPage>
  );
}

function ExistingShiftEditor({
  baseId,
  shift,
  roles,
  terms,
  onSave,
  onDelete,
}: {
  baseId: string;
  shift: VolunteerShiftView;
  roles: VolunteerRoleView[];
  terms: VolunteerProgramUiTerms;
  onSave: (patch: {
    startLocal: string;
    endLocal: string;
    creditHours: number;
    roles: DraftShiftRole[];
    scope: 'this' | 'all';
    recurrence?: { rrule: string; endDate?: string; count?: number } | null;
  }) => void;
  onDelete: () => void;
}) {
  const [startLocal, setStartLocal] = useState(toDateTimeLocal(shift.startDt));
  const [endLocal, setEndLocal] = useState(toDateTimeLocal(shift.endDt));
  const [creditHours, setCreditHours] = useState(
    String(shift.creditHours ?? volunteerHoursFromRange(shift.startDt, shift.endDt))
  );
  const [shiftRoles, setShiftRoles] = useState<DraftShiftRole[]>(
    shift.roles.map((r) => ({ roleId: r.roleId, volunteersNeeded: r.volunteersNeeded }))
  );
  const [showAddRole, setShowAddRole] = useState(false);
  const [editScope, setEditScope] = useState<'this' | 'all'>('this');
  const isRecurring = shift.recurrenceSeriesId != null;
  const matchesCalendar = shift.sourceCalendarEventId != null;
  const recurrence = useRecurrenceState(shift.recurrenceRule ?? '', startLocal.slice(0, 10));
  const scopeLabelId = `${baseId}-scope-label`;
  const isEditingSingleInstance = isRecurring && editScope === 'this';

  useEffect(() => {
    setStartLocal(toDateTimeLocal(shift.startDt));
    setEndLocal(toDateTimeLocal(shift.endDt));
    setCreditHours(String(shift.creditHours ?? volunteerHoursFromRange(shift.startDt, shift.endDt)));
    setShiftRoles(shift.roles.map((r) => ({ roleId: r.roleId, volunteersNeeded: r.volunteersNeeded })));
    setShowAddRole(false);
  }, [shift]);

  const availableRoles = roles.filter((r) => !shiftRoles.some((sr) => sr.roleId === r.id));
  const multiRole = shiftRoles.length > 1;

  const updateNeeded = (roleId: number, raw: string) => {
    const n = Number.parseInt(raw, 10);
    setShiftRoles((prev) =>
      prev.map((r) =>
        r.roleId === roleId
          ? { ...r, volunteersNeeded: Number.isFinite(n) && n > 0 ? n : 1 }
          : r
      )
    );
  };

  return (
    <div className="app-card p-4 space-y-3">
      {matchesCalendar ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Times match the attached calendar event and update automatically.
        </p>
      ) : isRecurring ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">Recurring {terms.shiftSingular}</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Start" htmlFor={`${baseId}-start`} required>
          <input
            id={`${baseId}-start`}
            type="datetime-local"
            className="app-input"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            readOnly={matchesCalendar}
          />
        </FormField>
        <FormField label="End" htmlFor={`${baseId}-end`} required>
          <input
            id={`${baseId}-end`}
            type="datetime-local"
            className="app-input"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
            readOnly={matchesCalendar}
          />
        </FormField>
      </div>
      <FormField
        label="Volunteer credit hours"
        htmlFor={`${baseId}-credit`}
        helperText={`Hours of volunteer credit granted for completing this ${terms.shiftSingular}.`}
      >
        <input
          id={`${baseId}-credit`}
          type="number"
          min={0}
          step={0.1}
          className="app-input w-32"
          value={creditHours}
          onChange={(e) => setCreditHours(e.target.value)}
        />
      </FormField>

      {isRecurring ? (
        <FormField
          label={`This is a recurring ${terms.shiftSingular}. Apply changes to:`}
          labelId={scopeLabelId}
        >
          <ChoiceInput<'this' | 'all'>
            layout="inline"
            ariaLabelledBy={scopeLabelId}
            options={[
              { value: 'this', label: 'This instance only' },
              { value: 'all', label: 'All instances' },
            ]}
            value={editScope}
            onChange={(next) => {
              if (next === 'this' || next === 'all') setEditScope(next);
            }}
          />
        </FormField>
      ) : null}

      {isRecurring && !isEditingSingleInstance && !matchesCalendar ? (
        <RecurrenceFields
          idPrefix={`${baseId}-recurrence`}
          startDate={startLocal.slice(0, 10)}
          startTime={startLocal.slice(11, 16) || '09:00'}
          allowNone={false}
          requireLimit
          state={recurrence}
        />
      ) : null}

      {!multiRole && shiftRoles[0] ? (
        <>
          <div>
            <div className="app-label">{terms.roleTitle}</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">
              {roles.find((r) => r.id === shiftRoles[0].roleId)?.name
                || shift.roles.find((r) => r.roleId === shiftRoles[0].roleId)?.roleName
                || `${terms.roleTitle} ${shiftRoles[0].roleId}`}
            </div>
          </div>
          <FormField
            label="Capacity"
            htmlFor={`${baseId}-need-${shiftRoles[0].roleId}`}
            required
          >
            <input
              id={`${baseId}-need-${shiftRoles[0].roleId}`}
              type="number"
              min={1}
              className="app-input w-28"
              value={shiftRoles[0].volunteersNeeded}
              onChange={(e) => updateNeeded(shiftRoles[0].roleId, e.target.value)}
              required
            />
          </FormField>
        </>
      ) : (
        <div className="inline-grid max-w-full grid-cols-[auto_7rem_auto] items-center gap-x-4 gap-y-2">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{terms.roleTitle}</div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Capacity</div>
          <div />
          {shiftRoles.map((role) => {
            const meta = roles.find((r) => r.id === role.roleId);
            const roleName = meta?.name || `${terms.roleTitle} ${role.roleId}`;
            const needId = `${baseId}-need-${role.roleId}`;
            return (
              <Fragment key={role.roleId}>
                <div className="min-w-0 font-medium text-gray-900 dark:text-gray-100">
                  {roleName}
                </div>
                <input
                  id={needId}
                  type="number"
                  min={1}
                  className="app-input w-full"
                  value={role.volunteersNeeded}
                  onChange={(e) => updateNeeded(role.roleId, e.target.value)}
                  required
                  aria-label={`Capacity for ${roleName}`}
                />
                <button
                  type="button"
                  className="text-sm text-primary-teal-link hover:underline"
                  onClick={() =>
                    setShiftRoles((prev) => prev.filter((r) => r.roleId !== role.roleId))
                  }
                >
                  Remove
                </button>
              </Fragment>
            );
          })}
        </div>
      )}

      {availableRoles.length > 0 ? (
        showAddRole ? (
          <FormField label={`${terms.roleTitle} to add`} htmlFor={`${baseId}-add-role`}>
            <ChoiceInput<number>
              key={`add-role-${availableRoles.map((r) => r.id).join('-')}`}
              inputId={`${baseId}-add-role`}
              options={availableRoles.map((r) => ({ value: r.id, label: r.name }))}
              value={null}
              onChange={(next) => {
                const roleId = Array.isArray(next) ? next[0] ?? null : next;
                if (!roleId) return;
                setShiftRoles((prev) => [...prev, { roleId, volunteersNeeded: 1 }]);
                if (availableRoles.length <= 1) setShowAddRole(false);
              }}
              placeholder={`Select a ${terms.roleSingular}...`}
            />
          </FormField>
        ) : (
          <button
            type="button"
            className="text-sm font-medium text-primary-teal-link hover:underline"
            onClick={() => setShowAddRole(true)}
          >
            Add another {terms.roleSingular}
          </button>
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => {
            if (isRecurring && editScope === 'all' && !matchesCalendar) {
              if (!recurrence.payload) {
                return;
              }
              if (!recurrence.endDate && recurrence.count === '' && !/UNTIL=|COUNT=/i.test(recurrence.rrule)) {
                return;
              }
            }
            const parsedCredit = Number.parseFloat(creditHours);
            onSave({
              startLocal,
              endLocal,
              creditHours:
                Number.isFinite(parsedCredit) && parsedCredit >= 0
                  ? parsedCredit
                  : volunteerHoursFromRange(fromDateTimeLocal(startLocal), fromDateTimeLocal(endLocal)),
              roles: shiftRoles,
              scope: editScope,
              recurrence:
                !matchesCalendar && isRecurring && editScope === 'all' ? recurrence.payload : undefined,
            });
          }}
        >
          Save {terms.shiftSingular}
        </Button>
        <Button type="button" variant="secondary" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
