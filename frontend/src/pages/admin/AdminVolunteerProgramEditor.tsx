import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { resolveSiteName } from '../../components/SeoMeta';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useSiteBranding } from '../../hooks/useSiteBranding';
import api, { formatApiError } from '../../utils/api';
import { memberHasScope } from '../../utils/permissions';
import { getWeekdayFromDate } from '../calendarEventFormShared';
import { formatPhone } from '../../utils/phone';
import {
  addMinutesToDateTimeLocal,
  formatDurationMinutes,
  formatVolunteerRange,
  fromDateTimeLocal,
  hoursInputToMinutes,
  minutesToHoursInput,
  toDateTimeLocal,
  VOLUNTEER_LOCATION_CLUB,
  volunteerLocationChoiceFromStored,
  volunteerLocationStoredFromChoice,
  volunteerShiftHasEnded,
  type VolunteerLocationChoice,
  type VolunteerProgramView,
  type VolunteerRoleView,
  type VolunteerShiftView,
  type VolunteerSignupView,
} from '../../utils/volunteering';

type TabKey = 'settings' | 'description' | 'roles' | 'shifts' | 'signups';
const secondaryTabs = ['description', 'roles', 'shifts', 'signups'] as const;

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

function createEmptyTimeRow(
  programStartDate?: string | null,
  defaultDurationMinutes?: number | null
): NewShiftTimeRow {
  const startLocal = programStartDate ? `${programStartDate}T09:00` : '';
  const endLocal =
    startLocal && defaultDurationMinutes
      ? addMinutesToDateTimeLocal(startLocal, defaultDurationMinutes)
      : '';
  return {
    key: `shift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startLocal,
    endLocal,
    endManuallyEdited: false,
  };
}

export default function AdminVolunteerProgramEditor() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const isNew = id === 'new';
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

  const activeTab: TabKey =
    !isNew && tab && (secondaryTabs as readonly string[]).includes(tab) ? (tab as TabKey) : 'settings';

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
  const [startDate, setStartDate] = useState('');
  const [published, setPublished] = useState(false);
  const [featureOnDashboard, setFeatureOnDashboard] = useState(true);
  const [publicSignups, setPublicSignups] = useState(false);
  const [priority, setPriority] = useState('');
  const [managerIds, setManagerIds] = useState<number[]>([]);

  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [roleDurationHours, setRoleDurationHours] = useState('3');
  const [roleCredentialIds, setRoleCredentialIds] = useState<number[]>([]);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);

  const [newShiftRoleId, setNewShiftRoleId] = useState<number | null>(null);
  const [newShiftTimes, setNewShiftTimes] = useState<NewShiftTimeRow[]>([createEmptyTimeRow()]);
  const [newShiftNeeded, setNewShiftNeeded] = useState(1);
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
      setStartDate(data.startDate || '');
      setPublished(Boolean(data.published));
      setFeatureOnDashboard(data.featureOnDashboard !== false);
      setPublicSignups(Boolean(data.publicSignups));
      setPriority(data.priority == null ? '' : String(data.priority));
      setManagerIds(data.managers.map((m) => m.id));
      setNewShiftTimes((prev) => {
        const onlyEmpty =
          prev.length === 1 && !prev[0].startLocal && !prev[0].endLocal;
        if (onlyEmpty && data.startDate) {
          return [
            createEmptyTimeRow(
              data.startDate,
              data.roles[0]?.defaultDurationMinutes || 180
            ),
          ];
        }
        return prev;
      });
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
      .get('/volunteering/admin/credentials')
      .then((res) => {
        const list = (res.data?.credentials || []) as Array<{ id: number; name: string }>;
        setAllCredentials(list.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {
        // Ignore 403 for program-only managers.
      });
  }, []);

  const selectedRoleForShift = useMemo(
    () => program?.roles.find((r) => r.id === newShiftRoleId) ?? null,
    [program, newShiftRoleId]
  );
  const visibleSignupShifts = useMemo(() => {
    if (!program) return [];
    if (includeArchivedSignups) return program.shifts;
    const nowIso = new Date().toISOString();
    return program.shifts.filter((shift) => !volunteerShiftHasEnded(shift.endDt, nowIso));
  }, [program, includeArchivedSignups]);
  const copyEmailRoleOptions = useMemo(
    (): ChoiceOption<number>[] =>
      (program?.roles ?? []).map((role) => ({ value: role.id, label: role.name })),
    [program]
  );
  const newShiftStartLocal = newShiftTimes[0]?.startLocal ?? '';
  const newShiftRecurrence = useRecurrenceState(
    '',
    newShiftStartLocal.slice(0, 10),
    { fallbackPreset: 'weekly' }
  );

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
    () => (program?.roles || []).map((r) => ({ value: r.id, label: r.name })),
    [program]
  );

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locationChoice === null) {
      showAlert('Enter a custom location, or choose the club', 'error');
      return;
    }
    let priorityValue: number | null = null;
    const priorityTrimmed = priority.trim();
    if (priorityTrimmed) {
      const parsed = Number.parseInt(priorityTrimmed, 10);
      if (!Number.isInteger(parsed) || String(parsed) !== priorityTrimmed) {
        showAlert('Priority must be a whole number, or left blank.', 'warning');
        return;
      }
      priorityValue = parsed;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        pointOfContact: pointOfContact.trim(),
        location: volunteerLocationStoredFromChoice(locationChoice, clubName),
        startDate: startDate.trim() || null,
        published,
        featureOnDashboard,
        publicSignups,
        priority: priorityValue,
        managerIds,
      };
      if (isNew) {
        const res = await api.post('/volunteering/admin/programs', payload);
        showAlert('Program created', 'success');
        navigate(`/admin/volunteering/${res.data.id}/description`);
      } else {
        const res = await api.patch(`/volunteering/admin/programs/${id}`, payload);
        const nextSlug = (res.data as VolunteerProgramView)?.slug || savedSlug;
        setSavedSlug(nextSlug);
        setSlug(nextSlug);
        showAlert('Program saved', 'success');
        await loadProgram();
      }
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
    if (!id || isNew) return;
    const minutes = hoursInputToMinutes(roleDurationHours);
    if (minutes == null) {
      showAlert('Enter a valid default duration in hours (for example 3 or 2.5).', 'warning');
      return;
    }
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
        showAlert('Role updated', 'success');
      } else {
        await api.post(`/volunteering/admin/programs/${id}/roles`, payload);
        showAlert('Role created', 'success');
      }
      resetRoleForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save role'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (role: VolunteerRoleView) => {
    const ok = await confirm({
      title: 'Delete role',
      message: `Delete role "${role.name}"? Shifts using this role will lose that assignment.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/roles/${role.id}`);
      showAlert('Role deleted', 'success');
      if (editingRoleId === role.id) resetRoleForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete role'), 'error');
    }
  };

  const resetNewShiftForm = () => {
    setNewShiftTimes([
      createEmptyTimeRow(
        program?.startDate,
        selectedRoleForShift?.defaultDurationMinutes ||
          (program?.startDate ? 180 : null)
      ),
    ]);
    setNewShiftNeeded(1);
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
        createEmptyTimeRow(
          program?.startDate,
          selectedRoleForShift?.defaultDurationMinutes ||
            (program?.startDate ? 180 : null)
        ),
      ];
    });
  };

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || isNew || !newShiftRoleId) return;
    const incomplete = newShiftTimes.some((row) => !row.startLocal || !row.endLocal);
    if (incomplete) {
      showAlert('Choose a start and end time for every shift.', 'warning');
      return;
    }
    if (recurringMode) {
      if (!newShiftRecurrence.payload) {
        showAlert('Choose a recurrence pattern.', 'warning');
        return;
      }
      if (!newShiftRecurrence.endDate && newShiftRecurrence.count === '') {
        showAlert('Recurring shifts need an end date or a count.', 'warning');
        return;
      }
    }
    setSavingShift(true);
    try {
      const template = {
        startDt: fromDateTimeLocal(newShiftTimes[0].startLocal),
        endDt: fromDateTimeLocal(newShiftTimes[0].endLocal),
        roles: [{ roleId: newShiftRoleId, volunteersNeeded: newShiftNeeded }],
      };
      const result = await api.post(`/volunteering/admin/programs/${id}/shifts/bulk`, recurringMode
        ? { shifts: [template], recurrence: newShiftRecurrence.payload }
        : {
            shifts: newShiftTimes.map((row) => ({
              startDt: fromDateTimeLocal(row.startLocal),
              endDt: fromDateTimeLocal(row.endLocal),
              roles: [{ roleId: newShiftRoleId, volunteersNeeded: newShiftNeeded }],
            })),
          });
      const count = Array.isArray(result.data?.shiftIds)
        ? result.data.shiftIds.length
        : recurringMode
          ? (newShiftRecurrence.previewCount ?? 1)
          : newShiftTimes.length;
      showAlert(
        count === 1 ? 'Shift created' : `${count} shifts created`,
        'success'
      );
      resetNewShiftForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to create shifts'), 'error');
    } finally {
      setSavingShift(false);
    }
  };

  const handleUpdateExistingShift = async (
    shift: VolunteerShiftView,
    patch: {
      startLocal: string;
      endLocal: string;
      roles: DraftShiftRole[];
      scope: 'this' | 'all';
      recurrence?: { rrule: string; endDate?: string; count?: number } | null;
    }
  ) => {
    try {
      await api.patch(`/volunteering/admin/shifts/${shift.id}`, {
        startDt: fromDateTimeLocal(patch.startLocal),
        endDt: fromDateTimeLocal(patch.endLocal),
        roles: patch.roles,
        scope: shift.recurrenceSeriesId != null ? patch.scope : undefined,
        recurrence:
          shift.recurrenceSeriesId != null && patch.scope === 'all' && patch.recurrence
            ? patch.recurrence
            : undefined,
      });
      showAlert(
        shift.recurrenceSeriesId != null && patch.scope === 'all'
          ? 'Recurring shifts updated'
          : 'Shift updated',
        'success'
      );
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to update shift'), 'error');
    }
  };

  const handleDeleteShift = async (shift: VolunteerShiftView) => {
    if (shift.recurrenceSeriesId != null) {
      setDeleteShiftTarget(shift);
      return;
    }
    const ok = await confirm({
      title: 'Delete shift',
      message: `Delete the shift on ${formatVolunteerRange(shift.startDt, shift.endDt)}? Signups for this shift will be removed.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/shifts/${shift.id}`);
      showAlert('Shift deleted', 'success');
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete shift'), 'error');
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
      showAlert(scope === 'all' ? 'Recurring shifts deleted' : 'Shift deleted', 'success');
      setDeleteShiftTarget(null);
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete shift'), 'error');
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
      showAlert('Select at least one role', 'warning');
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
      to: isNew ? '/admin/volunteering/new' : `/admin/volunteering/${id}`,
    },
    ...(!isNew
      ? [
          {
            key: 'description',
            label: 'Description',
            isActive: activeTab === 'description',
            to: `/admin/volunteering/${id}/description`,
          },
          {
            key: 'roles',
            label: 'Roles',
            isActive: activeTab === 'roles',
            to: `/admin/volunteering/${id}/roles`,
          },
          {
            key: 'shifts',
            label: 'Shifts',
            isActive: activeTab === 'shifts',
            to: `/admin/volunteering/${id}/shifts`,
          },
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
          actions={<BackButton label="Back to programs" to="/admin/volunteering" />}
        />
        <AppStateCard title="Loading program..." />
      </AppPage>
    );
  }

  const shiftsByDate = (program?.shifts || []).reduce<Record<string, VolunteerShiftView[]>>((acc, shift) => {
    const key = shift.startDt.slice(0, 10);
    (acc[key] ||= []).push(shift);
    return acc;
  }, {});

  return (
    <AppPage>
      <AppPageHeader
        title={isNew ? 'Create volunteer program' : program?.title || 'Edit program'}
        description={isNew ? 'Add a program, then add a description. Roles and shifts are optional.' : undefined}
        actions={<BackButton label="Back to programs" to="/admin/volunteering" />}
      />
      <PageTabs items={tabItems} />

      {activeTab === 'settings' ? (
        <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl">
          <FormSection title="Program details" surface="panel">
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
            <FormField
              label="Start date"
              htmlFor={`${baseId}-start-date`}
              optional
            >
              <input
                id={`${baseId}-start-date`}
                type="date"
                className="app-input w-full max-w-xs"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </FormField>
            <FormField label="Managers" htmlFor={`${baseId}-managers`}>
              <MemberMultiSelect
                selectedIds={managerIds}
                onChange={setManagerIds}
                placeholder="Search members to add as managers..."
              />
            </FormField>
            <FormField
              label="Priority"
              htmlFor={`${baseId}-priority`}
              optional
              helperText="Lower numbers appear first on the volunteering hub and member dashboard. Leave blank to sort after programs that have a priority."
            >
              <input
                id={`${baseId}-priority`}
                type="number"
                step={1}
                className="app-input w-full max-w-xs"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </FormField>
            <FormCheckbox
              label="Published"
              checked={published}
              onChange={setPublished}
              helperText="Published programs appear on the volunteering hub."
            />
            <FormCheckbox
              label="Feature on dashboard"
              checked={featureOnDashboard}
              onChange={setFeatureOnDashboard}
              helperText="When enabled, open shifts from this program can appear in the member dashboard opportunities section."
            />
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
          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create program' : 'Save settings'}
            </Button>
          </div>
        </form>
      ) : null}

      {activeTab === 'description' && program ? (
        <form onSubmit={handleSaveDescription} className="space-y-4">
          <FormField
            label="Description"
            labelId={descriptionLabelId}
            optional
            helperPlacement="after-label"
            helperText="Shown on the volunteering hub and program pages. If you do not add roles and shifts, the program still appears as an opportunity with this description."
          >
            {({ describedBy }) => (
              <div
                role="group"
                aria-labelledby={descriptionLabelId}
                aria-describedby={describedBy}
                className="flex min-h-[460px] flex-col overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600"
              >
                <MarkdownDescriptionEditor
                  key={program.id}
                  ref={descriptionEditorRef}
                  initialValue={program.description ?? ''}
                  dark={resolvedTheme === 'dark'}
                  fill
                  includeHiddenContactRecipients
                  enableManagedFileImageEdit
                  onUploadImage={handleUploadMarkdownImage}
                />
              </div>
            )}
          </FormField>
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save description'}
            </Button>
          </div>
        </form>
      ) : null}

      {activeTab === 'roles' && program ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={handleSaveRole} className="space-y-4">
            <FormSection title={editingRoleId ? 'Edit role' : 'Add role'} surface="panel">
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
                helperText="Used to auto-fill shift end time when this role is selected."
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
                      <Link to="/admin/volunteering/credentials" className="text-primary-teal-link hover:underline">
                        Manage credentials
                      </Link>
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
                  {saving ? 'Saving…' : editingRoleId ? 'Update role' : 'Add role'}
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
            <h2 className="app-section-title">Roles ({program.roles.length})</h2>
            {program.roles.length === 0 ? (
              <InlineStateMessage title="No roles yet. Add the jobs volunteers can fill, or skip this tab if the description is enough." />
            ) : (
              program.roles.map((role) => (
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

      {activeTab === 'shifts' && program ? (
        <div className="space-y-8">
          {program.roles.length === 0 ? (
            <AppStateCard
              title="Add roles first"
              description="Create at least one role before adding shifts."
              action={
                <Link to={`/admin/volunteering/${id}/roles`}>
                  <Button type="button">Go to roles</Button>
                </Link>
              }
            />
          ) : (
            <>
              <form onSubmit={handleCreateShift} className="max-w-3xl">
                <FormSection
                  title="Add shift"
                  surface="panel"
                  description="A shift specifies a time period for volunteers to work."
                >
                  <FormField label="Role" htmlFor={`${baseId}-shift-role`} required>
                    <ChoiceInput<number>
                      inputId={`${baseId}-shift-role`}
                      options={roleOptions}
                      value={newShiftRoleId}
                      onChange={(next) => {
                        setNewShiftRoleId(Array.isArray(next) ? next[0] ?? null : next);
                      }}
                      placeholder="Select a role..."
                    />
                  </FormField>
                  {selectedRoleForShift ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400 -mt-2 mb-3">
                      Default duration for this role:{' '}
                      {formatDurationMinutes(selectedRoleForShift.defaultDurationMinutes || 180)}
                    </p>
                  ) : null}

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
                          Add additional shift
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
                              Set up recurring shifts
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

                  <FormField
                    label={
                      recurringMode || newShiftTimes.length > 1
                        ? 'Volunteers needed per shift'
                        : 'Volunteers needed'
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
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={savingShift || !newShiftRoleId}>
                      {savingShift
                        ? 'Saving…'
                        : recurringMode || newShiftTimes.length > 1
                          ? 'Add shifts'
                          : 'Add shift'}
                    </Button>
                  </div>
                </FormSection>
              </form>

              <section className="space-y-4">
                <h2 className="app-section-title">Existing shifts ({program.shifts.length})</h2>
                {program.shifts.length === 0 ? (
                  <InlineStateMessage title="No shifts saved yet." />
                ) : (
                  Object.entries(shiftsByDate)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([dateKey, shifts]) => (
                      <div key={dateKey} className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </h3>
                        {shifts.map((shift) => (
                          <ExistingShiftEditor
                            key={shift.id}
                            baseId={`${baseId}-shift-${shift.id}`}
                            shift={shift}
                            roles={program.roles}
                            onSave={(patch) => handleUpdateExistingShift(shift, patch)}
                            onDelete={() => handleDeleteShift(shift)}
                          />
                        ))}
                      </div>
                    ))
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
                  label="Include past shifts"
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
              <AppStateCard title="No shifts yet" description="Add shifts before managing signups." />
            ) : visibleSignupShifts.length === 0 ? (
              <AppStateCard
                title="No upcoming sign-ups"
                description="Past shifts are hidden. Include past shifts to review them."
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
                                  manageForOthers: true,
                                  signedUpMemberIds: role.signups
                                    .map((signup) => signup.memberId)
                                    .filter((id): id is number => id != null),
                                })
                              }
                            >
                              Add volunteers
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
            label="Roles"
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
                listboxLabel="Roles"
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
        title="Delete shift"
      >
        {deleteShiftTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This is a recurring shift. Delete this instance only, or all remaining instances in
              the series? Signups for deleted shifts will be removed.
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
                ? 'Volunteer signed up. A confirmation email is on the way.'
                : `${count} volunteers signed up. Confirmation emails are on the way.`,
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
  onSave,
  onDelete,
}: {
  baseId: string;
  shift: VolunteerShiftView;
  roles: VolunteerRoleView[];
  onSave: (patch: {
    startLocal: string;
    endLocal: string;
    roles: DraftShiftRole[];
    scope: 'this' | 'all';
    recurrence?: { rrule: string; endDate?: string; count?: number } | null;
  }) => void;
  onDelete: () => void;
}) {
  const [startLocal, setStartLocal] = useState(toDateTimeLocal(shift.startDt));
  const [endLocal, setEndLocal] = useState(toDateTimeLocal(shift.endDt));
  const [shiftRoles, setShiftRoles] = useState<DraftShiftRole[]>(
    shift.roles.map((r) => ({ roleId: r.roleId, volunteersNeeded: r.volunteersNeeded }))
  );
  const [showAddRole, setShowAddRole] = useState(false);
  const [editScope, setEditScope] = useState<'this' | 'all'>('this');
  const isRecurring = shift.recurrenceSeriesId != null;
  const recurrence = useRecurrenceState(shift.recurrenceRule ?? '', startLocal.slice(0, 10));
  const scopeLabelId = `${baseId}-scope-label`;
  const isEditingSingleInstance = isRecurring && editScope === 'this';

  useEffect(() => {
    setStartLocal(toDateTimeLocal(shift.startDt));
    setEndLocal(toDateTimeLocal(shift.endDt));
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
      {isRecurring ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">Recurring shift</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Start" htmlFor={`${baseId}-start`} required>
          <input
            id={`${baseId}-start`}
            type="datetime-local"
            className="app-input"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />
        </FormField>
        <FormField label="End" htmlFor={`${baseId}-end`} required>
          <input
            id={`${baseId}-end`}
            type="datetime-local"
            className="app-input"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
          />
        </FormField>
      </div>

      {isRecurring ? (
        <FormField
          label="This is a recurring shift. Apply changes to:"
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

      {isRecurring && !isEditingSingleInstance ? (
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
            <div className="app-label">Role</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">
              {roles.find((r) => r.id === shiftRoles[0].roleId)?.name
                || shift.roles.find((r) => r.roleId === shiftRoles[0].roleId)?.roleName
                || `Role ${shiftRoles[0].roleId}`}
            </div>
          </div>
          <FormField
            label="Volunteers needed for this shift"
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
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Role</div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Volunteers</div>
          <div />
          {shiftRoles.map((role) => {
            const meta = roles.find((r) => r.id === role.roleId);
            const roleName = meta?.name || `Role ${role.roleId}`;
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
                  aria-label={`Volunteers needed for ${roleName}`}
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
          <FormField label="Role to add" htmlFor={`${baseId}-add-role`}>
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
              placeholder="Select a role..."
            />
          </FormField>
        ) : (
          <button
            type="button"
            className="text-sm font-medium text-primary-teal-link hover:underline"
            onClick={() => setShowAddRole(true)}
          >
            Add another role
          </button>
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => {
            if (isRecurring && editScope === 'all') {
              if (!recurrence.payload) {
                return;
              }
              if (!recurrence.endDate && recurrence.count === '' && !/UNTIL=|COUNT=/i.test(recurrence.rrule)) {
                return;
              }
            }
            onSave({
              startLocal,
              endLocal,
              roles: shiftRoles,
              scope: editScope,
              recurrence: isRecurring && editScope === 'all' ? recurrence.payload : undefined,
            });
          }}
        >
          Save shift
        </Button>
        <Button type="button" variant="secondary" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
