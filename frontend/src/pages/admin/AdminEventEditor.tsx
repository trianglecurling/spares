import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HiEye, HiEyeSlash, HiClipboardDocument, HiArrowPath, HiChevronDown } from 'react-icons/hi2';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import DragHandle from '../../components/dragDrop/DragHandle';
import SortableList from '../../components/dragDrop/SortableList';
import SortableRow from '../../components/dragDrop/SortableRow';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import Modal from '../../components/Modal';
import PageTabs from '../../components/PageTabs';
import AdminEventDetailsArticlePanel from './AdminEventDetailsArticlePanel';
import AdminEventTournamentPanel from './AdminEventTournamentPanel';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useMemberOptions } from '../../contexts/MemberOptionsContext';
import { LOCATION_OPTIONS } from '../calendarEventFormShared';
import {
  CUSTOM_FIELD_TYPES,
  PRESET_LABELS,
  isPresetFieldType,
  isSubheadingFieldType,
  presetScopeLocked,
  TEAM_POSITIONS_DOUBLES,
  TEAM_POSITIONS_FOUR,
  type PresetFieldType,
} from '../../utils/eventRegistrationFieldPresets';
import type { TournamentFormat } from '../../utils/tournamentDisplay';

interface Timespan {
  startDt: string;
  endDt: string;
}

interface RegistrationField {
  id?: number;
  label: string;
  fieldType: string;
  scope: string;
  required: boolean;
  options: string;
  sortOrder: number;
}

interface Registration {
  id: number;
  contact_name: string;
  contact_email: string;
  status: string;
  group_size: number;
  payment_order_id: number | null;
  waitlist_position: number | null;
  registered_at: string;
  groupMembers: Array<{ id?: number; name: string; email: string | null; sort_order?: number }>;
  fieldValues: Array<{
    field_id?: number;
    fieldId?: number;
    registration_member_id?: number | null;
    registrationMemberId?: number | null;
    value: string | null;
  }>;
}

interface SpecialLink {
  id: number;
  token: string;
  label: string | null;
  override_fee_minor: number | null;
  max_group_size: number | null;
  bypass_capacity: number;
  ignore_registration_dates: number;
  used: number;
  invalidated: number;
  created_at: string;
}

/** Rows returned from GET /events/:id for timespans and registration fields */
interface ApiEventTimespanRow {
  start_dt: string;
  end_dt: string;
}

interface ApiRegistrationFieldRow {
  id?: number;
  label: string;
  field_type: string;
  scope?: string;
  required?: number | boolean;
  options?: string;
  sort_order?: number;
}

type EventEditorSavePayload = {
  title: string;
  slug: string | undefined;
  visibility: string;
  calendarTypeId: string;
  published: boolean;
  capacity: number | null;
  feeMinor: number;
  memberFeeMinor: number | null;
  registrationStart: string | null;
  registrationCutoff: string | null;
  cancellationCutoff: string | null;
  allowGroupRegistration: boolean;
  maxGroupSize: number | null;
  enableWaitlist: boolean;
  timespans: Array<{ startDt: string; endDt: string }>;
  locations: Array<
    | { locationType: 'sheet'; sheetId: number }
    | { locationType: 'warm-room' | 'exterior' | 'offsite' | 'virtual' }
  >;
  categoryIds: number[];
  ownerMemberIds: number[];
  registrationFields: Array<{
    id?: number;
    label: string;
    fieldType: string;
    scope: string;
    required: boolean;
    options: string | null;
    sortOrder: number;
  }>;
};

const EVENT_CALENDAR_TYPE_OPTIONS: { id: string; label: string }[] = [
  { id: 'bonspiel', label: 'Bonspiel' },
  { id: 'learn-to-curl', label: 'Learn to Curl' },
  { id: 'juniors', label: 'Juniors' },
  { id: 'other', label: 'Other' },
];

const EVENT_CALENDAR_CHOICE_OPTIONS: ChoiceOption<string>[] = EVENT_CALENDAR_TYPE_OPTIONS.map((o) => ({
  value: o.id,
  label: o.label,
}));

const EVENT_VISIBILITY_OPTIONS: ChoiceOption<string>[] = [
  { value: 'public', label: 'Public' },
  { value: 'active_members', label: 'Active members' },
  { value: 'ice_members', label: 'Ice members' },
];

const REGISTRATION_SCOPE_OPTIONS: ChoiceOption<string>[] = [
  { value: 'group', label: 'Per group' },
  { value: 'individual', label: 'Per person' },
];

const CUSTOM_FIELD_TYPE_OPTIONS: ChoiceOption<string>[] = CUSTOM_FIELD_TYPES.map((ft) => ({
  value: ft,
  label: ft,
}));

function toMinor(dollars: string): number {
  const parsed = Number.parseFloat(dollars);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function toDollars(minor: number): string {
  if (!minor) return '';
  return (minor / 100).toFixed(2);
}

export default function AdminEventEditor() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const isNew = id === 'new';
  const eventId = isNew ? null : parseInt(id || '', 10);
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // Sheets for pickers
  const [sheets, setSheets] = useState<Array<{ id: number; name: string }>>([]);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [calendarTypeId, setCalendarTypeId] = useState('other');
  const [tournamentTeamsPublished, setTournamentTeamsPublished] = useState(false);
  const [tournamentDrawPublished, setTournamentDrawPublished] = useState(false);
  const [tournamentFormat, setTournamentFormat] = useState<TournamentFormat | null>(null);
  const [published, setPublished] = useState(false);
  const [capacity, setCapacity] = useState('');
  const [feeDollars, setFeeDollars] = useState('');
  /** Optional lower per-person fee when the registrant is logged in as a member. Empty = use regular fee only. */
  const [memberFeeDollars, setMemberFeeDollars] = useState('');
  const [registrationStart, setRegistrationStart] = useState('');
  const [registrationCutoff, setRegistrationCutoff] = useState('');
  const [cancellationCutoff, setCancellationCutoff] = useState('');
  const [allowGroupRegistration, setAllowGroupRegistration] = useState(false);
  const [maxGroupSize, setMaxGroupSize] = useState('');
  const [enableWaitlist, setEnableWaitlist] = useState(true);
  const [timespans, setTimespans] = useState<Timespan[]>([{ startDt: '', endDt: '' }]);
  const [selectedSheets, setSelectedSheets] = useState<number[]>([]);
  const [selectedFixedLocs, setSelectedFixedLocs] = useState<
    Array<'warm-room' | 'exterior' | 'offsite' | 'virtual'>
  >([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [ownerMemberIds, setOwnerMemberIds] = useState<number[]>([]);
  const [registrationFields, setRegistrationFields] = useState<RegistrationField[]>([]);

  // Registration data
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [registrationsLoaded, setRegistrationsLoaded] = useState(false);
  const [showRegistrationsSlowLoader, setShowRegistrationsSlowLoader] = useState(false);
  const [registrationSearch, setRegistrationSearch] = useState('');
  const [registrationSortKey, setRegistrationSortKey] = useState<string>('date');
  const [registrationSortOrder, setRegistrationSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportTsv, setExportTsv] = useState('');
  const [cancelTarget, setCancelTarget] = useState<Registration | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [teamFieldView, setTeamFieldView] = useState<{ registration: Registration; field: RegistrationField } | null>(
    null,
  );

  // Special links
  const [specialLinks, setSpecialLinks] = useState<SpecialLink[]>([]);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkFee, setNewLinkFee] = useState('');
  const [newLinkMaxGroupSize, setNewLinkMaxGroupSize] = useState('');
  const [newLinkBypassCapacity, setNewLinkBypassCapacity] = useState(false);
  const [newLinkIgnoreDates, setNewLinkIgnoreDates] = useState(false);
  const [revealedLinks, setRevealedLinks] = useState<Set<number>>(new Set());
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  const [detailLink, setDetailLink] = useState<SpecialLink | null>(null);
  const [linkedArticleId, setLinkedArticleId] = useState<number | null>(null);

  const isBonspielEvent = calendarTypeId === 'bonspiel';
  const secondaryTabKeys = useMemo(() => {
    if (isNew) return [] as const;
    const tail = ['registrations', 'links'] as const;
    if (isBonspielEvent) {
      return ['details', 'tournament', ...tail] as const;
    }
    return ['details', ...tail] as const;
  }, [isNew, isBonspielEvent]);

  type SecondaryTabKey = (typeof secondaryTabKeys)[number];
  type TabKey = 'settings' | SecondaryTabKey;
  const activeTab: TabKey =
    !isNew && tab && (secondaryTabKeys as readonly string[]).includes(tab) ? (tab as TabKey) : 'settings';

  const [showScopePrompt, setShowScopePrompt] = useState(false);
  const [addFieldMenuOpen, setAddFieldMenuOpen] = useState(false);
  const addFieldMenuRef = useRef<HTMLDivElement | null>(null);

  // Owner picker
  const [addingOwner, setAddingOwner] = useState<number | ''>('');
  const { options: memberOptions } = useMemberOptions();

  const presetMenuItems: PresetFieldType[] = [
    'preset_address',
    'preset_phone',
    'preset_dob',
    'preset_team_four',
    'preset_team_doubles',
  ];

  useEffect(() => {
    if (!addFieldMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!addFieldMenuRef.current) return;
      if (addFieldMenuRef.current.contains(event.target as Node)) return;
      setAddFieldMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [addFieldMenuOpen]);

  useEffect(() => {
    api
      .get<Array<{ id: number; name: string; isActive?: boolean }>>('/sheets')
      .catch(() => ({ data: [] as Array<{ id: number; name: string; isActive?: boolean }> }))
      .then((sheetsRes) => {
        const rows = sheetsRes.data ?? [];
        const active = rows.filter((s) => s.isActive !== false);
        setSheets(active.map((s) => ({ id: s.id, name: s.name })));
      });
  }, []);

  useEffect(() => {
    if (isNew || !eventId) return;
    setLoading(true);
    api.get(`/events/${eventId}`)
      .then((res) => {
        const e = res.data;
        setTitle(e.title || '');
        setSlug(e.slug || '');
        setVisibility(e.visibility || 'public');
        setCalendarTypeId(
          typeof e.calendarTypeId === 'string' && EVENT_CALENDAR_TYPE_OPTIONS.some((o) => o.id === e.calendarTypeId)
            ? e.calendarTypeId
            : 'other',
        );
        setTournamentTeamsPublished((e.tournamentTeamsPublished ?? 0) === 1);
        setTournamentDrawPublished((e.tournamentDrawPublished ?? 0) === 1);
        setTournamentFormat(
          e.tournamentFormat === 'fours' || e.tournamentFormat === 'doubles' ? e.tournamentFormat : null,
        );
        setPublished(!!e.published);
        setCapacity(e.capacity !== null ? String(e.capacity) : '');
        setFeeDollars(toDollars(e.feeMinor ?? 0));
        setMemberFeeDollars(
          e.memberFeeMinor != null && e.memberFeeMinor !== undefined ? toDollars(e.memberFeeMinor) : '',
        );
        setRegistrationStart(e.registrationStart ? toDateTimeLocal(e.registrationStart) : '');
        setRegistrationCutoff(e.registrationCutoff ? toDateTimeLocal(e.registrationCutoff) : '');
        setCancellationCutoff(e.cancellationCutoff ? toDateTimeLocal(e.cancellationCutoff) : '');
        setAllowGroupRegistration(!!e.allowGroupRegistration);
        setMaxGroupSize(e.maxGroupSize !== null ? String(e.maxGroupSize) : '');
        setEnableWaitlist(e.enableWaitlist !== 0);
        setTimespans(
          (e.timespans || []).map((ts: ApiEventTimespanRow) => ({
            startDt: toDateTimeLocal(ts.start_dt),
            endDt: toDateTimeLocal(ts.end_dt),
          })),
        );
        const locs: Array<{ location_type: string; sheet_id?: number }> = e.locations || [];
        setSelectedSheets(
          locs
            .filter((l) => l.location_type === 'sheet' && l.sheet_id)
            .map((l) => l.sheet_id!),
        );
        setSelectedFixedLocs(
          locs
            .filter((l) => l.location_type !== 'sheet')
            .map((l) => l.location_type as 'warm-room' | 'exterior' | 'offsite' | 'virtual'),
        );
        setCategoryIds(e.categoryIds || []);
        setOwnerMemberIds(e.ownerMemberIds || []);
        setLinkedArticleId(e.articleId ?? null);
        setRegistrationFields(
          (e.registrationFields || [])
            .map((f: ApiRegistrationFieldRow) => ({
              id: f.id,
              label: f.label,
              fieldType: f.field_type,
              scope: f.scope || 'group',
              required: f.required === 1,
              options: f.options || '',
              sortOrder: f.sort_order ?? 0,
            }))
            .sort((a: RegistrationField, b: RegistrationField) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
        );
      })
      .catch((err) => showAlert(formatApiError(err, 'Failed to load event'), 'error'))
      .finally(() => setLoading(false));
  }, [eventId, isNew]);

  useEffect(() => {
    if (isNew || loading) return;
    if (id && tab && !(secondaryTabKeys as readonly string[]).includes(tab)) {
      navigate(`/admin/events/${id}`, { replace: true });
    }
  }, [id, tab, navigate, secondaryTabKeys, isNew, loading]);

  useEffect(() => {
    setRegistrations([]);
    setRegistrationsLoaded(false);
    setLinksLoaded(false);
    setSpecialLinks([]);
    setRegistrationSearch('');
    setRegistrationSortKey('date');
    setRegistrationSortOrder('desc');
  }, [eventId]);

  useEffect(() => {
    if (activeTab === 'registrations' && eventId && !registrationsLoaded) {
      setShowRegistrationsSlowLoader(false);
      api.get(`/events/${eventId}/registrations`)
        .then((res) => setRegistrations(res.data || []))
        .catch(() => {})
        .finally(() => setRegistrationsLoaded(true));
    }
    if (activeTab === 'links' && eventId && !linksLoaded) {
      api.get(`/events/${eventId}/special-links`)
        .then((res) => setSpecialLinks(res.data || []))
        .catch(() => {})
        .finally(() => setLinksLoaded(true));
    }
  }, [activeTab, eventId]);

  useEffect(() => {
    if (activeTab !== 'registrations' || registrationsLoaded) {
      setShowRegistrationsSlowLoader(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowRegistrationsSlowLoader(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activeTab, registrationsLoaded]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const locations = [
      ...selectedSheets.map((sheetId) => ({ locationType: 'sheet' as const, sheetId })),
      ...selectedFixedLocs.map((type) => ({ locationType: type })),
    ];

    const payload: EventEditorSavePayload = {
      title,
      slug: slug || undefined,
      visibility,
      calendarTypeId,
      published,
      capacity: capacity ? parseInt(capacity, 10) : null,
      feeMinor: toMinor(feeDollars),
      memberFeeMinor: memberFeeDollars.trim() === '' ? null : toMinor(memberFeeDollars),
      registrationStart: registrationStart ? new Date(registrationStart).toISOString() : null,
      registrationCutoff: registrationCutoff ? new Date(registrationCutoff).toISOString() : null,
      cancellationCutoff: cancellationCutoff ? new Date(cancellationCutoff).toISOString() : null,
      allowGroupRegistration,
      maxGroupSize: maxGroupSize ? parseInt(maxGroupSize, 10) : null,
      enableWaitlist,
      timespans: timespans
        .filter((ts) => ts.startDt && ts.endDt)
        .map((ts) => ({
          startDt: new Date(ts.startDt).toISOString(),
          endDt: new Date(ts.endDt).toISOString(),
        })),
      locations,
      categoryIds,
      ownerMemberIds,
      registrationFields: registrationFields.map((f, i) => ({
        id: f.id,
        label: f.label,
        fieldType: f.fieldType,
        scope: f.scope,
        required: f.required,
        options: f.options || null,
        sortOrder: i,
      })),
    };

    try {
      if (isNew) {
        const res = await api.post('/events', payload);
        showAlert('Event created', 'success');
        navigate(`/admin/events/${res.data.id}`, { replace: true });
      } else {
        await api.patch(`/events/${eventId}`, payload);
        showAlert('Event saved', 'success');
      }
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save event'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const addTimespan = () => setTimespans([...timespans, { startDt: '', endDt: '' }]);
  const removeTimespan = (i: number) => setTimespans(timespans.filter((_, idx) => idx !== i));
  const updateTimespan = (i: number, field: keyof Timespan, value: string) => {
    const updated = [...timespans];
    updated[i] = { ...updated[i], [field]: value };
    setTimespans(updated);
  };

  const toggleSheet = (sheetId: number) => {
    setSelectedSheets((prev) =>
      prev.includes(sheetId) ? prev.filter((s) => s !== sheetId) : [...prev, sheetId],
    );
  };
  const toggleFixedLoc = (t: 'warm-room' | 'exterior' | 'offsite' | 'virtual') => {
    setSelectedFixedLocs((prev) =>
      prev.includes(t) ? prev.filter((l) => l !== t) : [...prev, t],
    );
  };

  const addOwner = () => {
    if (addingOwner !== '' && !ownerMemberIds.includes(addingOwner)) {
      setOwnerMemberIds([...ownerMemberIds, addingOwner]);
    }
    setAddingOwner('');
  };
  const removeOwner = (memberId: number) => {
    setOwnerMemberIds(ownerMemberIds.filter((id) => id !== memberId));
  };

  const addField = () =>
    setRegistrationFields([
      ...registrationFields,
      { label: '', fieldType: 'text', scope: 'group', required: false, options: '', sortOrder: registrationFields.length },
    ]);
  const addSubheading = () =>
    setRegistrationFields([
      ...registrationFields,
      {
        label: '',
        fieldType: 'subheading',
        scope: 'group',
        required: false,
        options: '',
        sortOrder: registrationFields.length,
      },
    ]);
  const addPreset = (preset: PresetFieldType) => {
    if (registrationFields.some((f) => f.fieldType === preset)) return;
    setRegistrationFields([
      ...registrationFields,
      {
        label: PRESET_LABELS[preset],
        fieldType: preset,
        scope: 'group',
        required: false,
        options: '',
        sortOrder: registrationFields.length,
      },
    ]);
  };
  const removeField = (i: number) => setRegistrationFields(registrationFields.filter((_, idx) => idx !== i));
  const updateField = (i: number, updates: Partial<RegistrationField>) => {
    const updated = [...registrationFields];
    updated[i] = { ...updated[i], ...updates };
    setRegistrationFields(updated);
  };

  const handleCreateSpecialLink = async () => {
    if (!eventId) return;
    try {
      const res = await api.post(`/events/${eventId}/special-links`, {
        label: newLinkLabel || undefined,
        overrideFeeminor: newLinkFee !== '' ? toMinor(newLinkFee) : undefined,
        maxGroupSize: newLinkMaxGroupSize !== '' ? parseInt(newLinkMaxGroupSize, 10) : undefined,
        bypassCapacity: newLinkBypassCapacity,
        ignoreRegistrationDates: newLinkIgnoreDates,
      });
      setSpecialLinks([res.data, ...specialLinks]);
      setNewLinkLabel('');
      setNewLinkFee('');
      setNewLinkMaxGroupSize('');
      setNewLinkBypassCapacity(false);
      setNewLinkIgnoreDates(false);
      showAlert('Special link created', 'success');
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to create special link'), 'error');
    }
  };

  const handleInvalidateLink = async (linkId: number) => {
    if (!eventId) return;
    const confirmed = await confirm({ message: 'Invalidate this special link?', title: 'Invalidate' });
    if (!confirmed) return;
    try {
      await api.delete(`/events/${eventId}/special-links/${linkId}`);
      setSpecialLinks(specialLinks.map((l) => (l.id === linkId ? { ...l, invalidated: 1 } : l)));
      showAlert('Link invalidated', 'success');
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to invalidate link'), 'error');
    }
  };

  const getLinkUrl = (link: SpecialLink) =>
    `${window.location.origin}/events/${encodeURIComponent(slug)}/register?slk=${link.token}`;

  const toggleRevealLink = (linkId: number) => {
    setRevealedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(linkId)) next.delete(linkId);
      else next.add(linkId);
      return next;
    });
  };

  const copyLinkUrl = async (link: SpecialLink) => {
    try {
      await navigator.clipboard.writeText(getLinkUrl(link));
      setCopiedLinkId(link.id);
      setTimeout(() => setCopiedLinkId((prev) => (prev === link.id ? null : prev)), 2000);
    } catch {
      showAlert('Failed to copy to clipboard', 'error');
    }
  };

  const registrationFieldsForData = useMemo(
    () => registrationFields.filter((f) => !isSubheadingFieldType(f.fieldType)),
    [registrationFields],
  );

  const formatFieldValue = (fieldType: string, value: string | null | undefined): string => {
    if (value == null || value === '') return '';
    if (fieldType === 'checkbox') {
      return value === '1' || value.toLowerCase() === 'true' ? 'Yes' : 'No';
    }
    if (fieldType === 'preset_team_four' || fieldType === 'preset_team_doubles') {
      return formatTeamPresetDisplay(value, fieldType);
    }
    if (fieldType === 'preset_address') {
      try {
        return JSON.stringify(JSON.parse(value));
      } catch {
        return value;
      }
    }
    return value;
  };

  const getRegistrationFieldValue = (registration: Registration, field: RegistrationField): string => {
    if (isSubheadingFieldType(field.fieldType)) return '';
    const targetFieldId = Number(field.id);
    if (!Number.isFinite(targetFieldId)) return '';
    const values = registration.fieldValues.filter((fv) => {
      const rawFieldId = fv.field_id ?? fv.fieldId;
      return Number(rawFieldId) === targetFieldId;
    });
    if (values.length === 0) return '';
    if (field.scope !== 'individual') {
      const groupValue = values.find((fv) => fv.registration_member_id == null) ?? values[0];
      return formatFieldValue(field.fieldType, groupValue?.value);
    }

    const memberNameById = new Map<number, string>();
    registration.groupMembers.forEach((member, index) => {
      if (member.id != null) memberNameById.set(member.id, member.name || `Group member ${index + 1}`);
    });
    return values
      .map((fv) => {
        const formatted = formatFieldValue(field.fieldType, fv.value);
        if (!formatted) return null;
        const memberId = fv.registration_member_id ?? fv.registrationMemberId;
        const scopeLabel = memberId == null
          ? 'Primary'
          : (memberNameById.get(memberId) ?? 'Group member');
        return `${scopeLabel}: ${formatted}`;
      })
      .filter(Boolean)
      .join(' | ');
  };

  const getRegistrationSearchText = (registration: Registration): string => {
    const customFieldText = registrationFieldsForData
      .map((field) => getRegistrationFieldValue(registration, field))
      .join(' ');
    const groupText = registration.groupMembers
      .map((member) => `${member.name || ''} ${member.email || ''}`)
      .join(' ');
    return [
      registration.contact_name,
      registration.contact_email,
      registration.status,
      groupText,
      customFieldText,
      formatDateTime24(registration.registered_at),
    ]
      .join(' ')
      .toLowerCase();
  };

  const getRegistrationSortValue = (registration: Registration, sortKey: string): string | number => {
    if (sortKey === 'date') {
      const timestamp = new Date(registration.registered_at).getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    }
    if (sortKey === 'name') {
      return registration.contact_name?.toLowerCase() || '';
    }
    if (sortKey === 'status') {
      return registration.status?.toLowerCase() || '';
    }
    if (sortKey.startsWith('custom:')) {
      const fieldId = Number.parseInt(sortKey.replace('custom:', ''), 10);
      if (!Number.isFinite(fieldId)) return '';
      const field = registrationFieldsForData.find((item) => Number(item.id) === fieldId);
      if (!field) return '';
      return getRegistrationFieldValue(registration, field).toLowerCase();
    }
    return '';
  };

  const compareRegistrations = (left: Registration, right: Registration): number => {
    const leftValue = getRegistrationSortValue(left, registrationSortKey);
    const rightValue = getRegistrationSortValue(right, registrationSortKey);
    let result = 0;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      result = leftValue - rightValue;
    } else {
      result = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
    }
    if (result === 0) {
      const tieBreak = (left.contact_name || '').localeCompare(right.contact_name || '', undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (tieBreak !== 0) {
        result = tieBreak;
      } else {
        const leftTime = new Date(left.registered_at).getTime();
        const rightTime = new Date(right.registered_at).getTime();
        result = (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
      }
    }
    return registrationSortOrder === 'asc' ? result : -result;
  };

  const visibleRegistrations = useMemo(() => {
    const needle = registrationSearch.trim().toLowerCase();
    const filtered = needle
      ? registrations.filter((registration) => getRegistrationSearchText(registration).includes(needle))
      : [...registrations];
    filtered.sort(compareRegistrations);
    return filtered;
  }, [
    registrations,
    registrationSearch,
    registrationSortKey,
    registrationSortOrder,
    registrationFields,
    registrationFieldsForData,
  ]);

  const activeRegistrationCount = registrations.filter((r) => r.status !== 'cancelled').length;

  const registrationColumns: Array<DataTableColumn<Registration, string>> = useMemo(() => {
    const baseColumns: Array<DataTableColumn<Registration, string>> = [
      {
        id: 'date',
        header: 'Date',
        sortable: true,
        sortKey: 'date',
        defaultSortDirection: 'desc',
        cellClassName: 'whitespace-nowrap text-sm text-gray-600 dark:text-gray-400',
        renderCell: (registration) => formatDateTime24(registration.registered_at),
      },
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        sortKey: 'name',
        defaultSortDirection: 'asc',
        cellClassName: 'font-medium text-gray-900 dark:text-gray-100',
        renderCell: (registration) => (
          <Link to={`/admin/events/${id}/registrations/${registration.id}`} className="text-primary-teal hover:underline">
            {registration.contact_name}
          </Link>
        ),
      },
      {
        id: 'email',
        header: 'Email',
        cellClassName: 'text-sm text-gray-600 dark:text-gray-400',
        renderCell: (registration) => registration.contact_email,
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        sortKey: 'status',
        defaultSortDirection: 'asc',
        align: 'center',
        renderCell: (registration) => (
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(registration.status)}`}>
            {registration.status.replace('_', ' ')}
          </span>
        ),
      },
    ];

    if (allowGroupRegistration) {
      baseColumns.push({
        id: 'groupSize',
        header: 'Group size',
        align: 'center',
        renderCell: (registration) => registration.group_size,
      });
    }

    return [
      ...baseColumns,
      ...registrationFieldsForData.map((field) => {
        const sortKey = field.id ? `custom:${field.id}` : undefined;
        return {
          id: `field-${field.id ?? field.label}`,
          header: field.label || '(untitled field)',
          sortable: Boolean(sortKey),
          sortKey,
          defaultSortDirection: 'asc' as const,
          cellClassName: 'min-w-[220px] text-sm text-gray-600 dark:text-gray-300',
          renderCell: (registration: Registration) => {
            const teamPreset =
              field.fieldType === 'preset_team_four' ||
              field.fieldType === 'preset_team_doubles';
            const cell = getRegistrationFieldValue(registration, field);
            const teamRaw = teamPreset ? getRegistrationFieldGroupRawValue(registration, field) : '';

            if (teamPreset) {
              return teamRaw ? (
                <button
                  type="button"
                  onClick={() => setTeamFieldView({ registration, field })}
                  className="text-sm font-medium text-primary-teal hover:underline"
                >
                  View
                </button>
              ) : (
                <span className="text-gray-400">-</span>
              );
            }

            return cell || <span className="text-gray-400">-</span>;
          },
        };
      }),
    ];
  }, [allowGroupRegistration, id, registrationFieldsForData]);

  const specialLinkColumns: Array<DataTableColumn<SpecialLink>> = useMemo(
    () => [
      {
        id: 'label',
        header: 'Label',
        renderCell: (link) => (
          <button
            type="button"
            onClick={() => setDetailLink(link)}
            className="text-left font-medium text-primary-teal hover:underline"
          >
            {link.label || '(no label)'}
          </button>
        ),
      },
      {
        id: 'link',
        header: 'Link',
        cellClassName: 'text-sm',
        renderCell: (link) => {
          const revealed = revealedLinks.has(link.id);
          const copied = copiedLinkId === link.id;
          return (
            <div className="flex items-center gap-1.5">
              {revealed ? (
                <code className="select-all break-all rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">
                  {getLinkUrl(link)}
                </code>
              ) : (
                <span className="text-xs italic text-gray-400 dark:text-gray-500">Hidden</span>
              )}
              <button
                type="button"
                onClick={() => toggleRevealLink(link.id)}
                className="shrink-0 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title={revealed ? 'Hide link' : 'Reveal link'}
              >
                {revealed ? <HiEyeSlash className="h-4 w-4" /> : <HiEye className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => copyLinkUrl(link)}
                className={`shrink-0 rounded p-1 ${copied ? 'text-green-600 dark:text-green-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                title={copied ? 'Copied!' : 'Copy link'}
              >
                <HiClipboardDocument className="h-4 w-4" />
              </button>
            </div>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        align: 'center',
        renderCell: (link) =>
          link.invalidated ? (
            <span className="text-xs text-red-600 dark:text-red-400">Invalidated</span>
          ) : link.used ? (
            <span className="text-xs text-gray-600 dark:text-gray-400">Used</span>
          ) : (
            <span className="text-xs text-green-600 dark:text-green-400">Active</span>
          ),
      },
    ],
    [copiedLinkId, revealedLinks]
  );

  const copyRegistrantEmails = async () => {
    const entries: string[] = [];
    const seen = new Set<string>();
    registrations.forEach((registration) => {
      const contactEmail = registration.contact_email?.trim();
      if (contactEmail) {
        const entry = `${registration.contact_name.trim()} <${contactEmail}>`;
        if (!seen.has(entry.toLowerCase())) {
          seen.add(entry.toLowerCase());
          entries.push(entry);
        }
      }
      registration.groupMembers.forEach((member, index) => {
        const email = member.email?.trim();
        if (!email) return;
        const name = member.name?.trim() || `Group member ${index + 1}`;
        const entry = `${name} <${email}>`;
        if (!seen.has(entry.toLowerCase())) {
          seen.add(entry.toLowerCase());
          entries.push(entry);
        }
      });
    });
    if (entries.length === 0) {
      showAlert('No registrant emails to copy', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(entries.join(', '));
      showAlert('Registrant emails copied', 'success');
    } catch {
      showAlert('Failed to copy emails', 'error');
    }
  };

  const buildRegistrationsTsv = () => {
    const exportRegistrations = [...registrations].sort(compareRegistrations);
    const customHeaders = registrationFieldsForData.flatMap((field) =>
      isTeamPresetFieldType(field.fieldType) ? teamFieldTsvHeaders(field) : [field.label || `field_${field.id ?? ''}`],
    );
    const header = [
      'id',
      'name',
      'email',
      'status',
      ...(allowGroupRegistration ? ['groupSize'] : []),
      'registeredAt',
      'groupMembers',
      'groupMemberEmails',
      ...customHeaders,
    ];
    const rows = exportRegistrations.map((registration) => {
      const baseValues = [
        registration.id,
        registration.contact_name,
        registration.contact_email,
        registration.status,
        ...(allowGroupRegistration ? [registration.group_size] : []),
        formatDateTime24(registration.registered_at),
        registration.groupMembers.map((member) => member.name).join(' | '),
        registration.groupMembers.map((member) => member.email || '').filter(Boolean).join(' | '),
      ];
      const customValues = registrationFieldsForData.flatMap((field) =>
        isTeamPresetFieldType(field.fieldType)
          ? teamFieldTsvValues(registration, field)
          : [getRegistrationFieldValue(registration, field)],
      );
      return [...baseValues, ...customValues].map(toTsvCell);
    });
    return [header.map(toTsvCell).join('\t'), ...rows.map((row) => row.join('\t'))].join('\n');
  };

  const handleOpenExportTsv = () => {
    if (!registrations.length) {
      showAlert('No registrations to export yet', 'warning');
      return;
    }
    setExportTsv(buildRegistrationsTsv());
    setIsExportModalOpen(true);
  };

  const handleCopyExportTsv = async () => {
    try {
      await navigator.clipboard.writeText(exportTsv);
      showAlert('TSV copied to clipboard!', 'success');
    } catch {
      showAlert('Failed to copy TSV', 'error');
    }
  };

  const handleCancelRegistration = async (withRefund: boolean) => {
    if (!eventId || !cancelTarget || cancelBusy) return;
    setCancelBusy(true);
    try {
      const res = await api.post<{ success: boolean; refundIssued?: boolean; refundError?: string | null }>(
        `/events/${eventId}/registrations/${cancelTarget.id}/cancel`,
        { refund: withRefund },
      );
      setRegistrations((prev) =>
        prev.map((registration) =>
          registration.id === cancelTarget.id
            ? { ...registration, status: 'cancelled' }
            : registration,
        ),
      );
      if (res.data?.refundError) {
        showAlert(`Registration cancelled. Refund failed: ${res.data.refundError}`, 'warning');
      } else if (withRefund && res.data?.refundIssued) {
        showAlert('Registration cancelled and refund initiated', 'success');
      } else {
        showAlert('Registration cancelled', 'success');
      }
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to cancel registration'), 'error');
    } finally {
      setCancelBusy(false);
      setCancelTarget(null);
    }
  };

  if (loading) {
    return (
      <Layout>
        <AppPage>
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading…</div>
        </AppPage>
      </Layout>
    );
  }

  const pageTitle = isNew ? 'New event' : `Edit: ${title}`;
  const pageSubtitle = isNew
    ? 'Create a new registrable club event.'
    : 'Update event settings, public page content, registrations, and links.';

  const tabs = [
    { key: 'settings' as const, label: 'Settings' },
    ...(!isNew
      ? [
          { key: 'details' as const, label: 'Details' },
          ...(isBonspielEvent ? [{ key: 'tournament' as const, label: 'Tournament' }] : []),
          { key: 'registrations' as const, label: 'Registrations' },
          { key: 'links' as const, label: 'Special registration links' },
        ]
      : []),
  ];

  return (
    <Layout>
      <AppPage
        narrow={activeTab !== 'registrations' && activeTab !== 'details' && activeTab !== 'tournament'}
        className={
          activeTab === 'tournament'
            ? 'flex min-h-0 flex-1 flex-col !space-y-6'
            : undefined
        }
      >
        <AppPageHeader
          title={pageTitle}
          description={pageSubtitle}
          actions={
            <BackButton label="Events" onClick={() => navigate('/admin/events')} />
          }
        />

        {tabs.length > 1 && (
          <PageTabs
            items={tabs.map((tab) => ({
              key: tab.key,
              label: tab.label,
              to: tab.key === 'settings' ? `/admin/events/${id}` : `/admin/events/${id}/${tab.key}`,
              isActive: activeTab === tab.key,
            }))}
          />
        )}

        {activeTab === 'settings' && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
            <form onSubmit={handleSave} className="flex flex-col gap-6">
              {/* Basic info */}
              <FormSection
                title="Basic info"
                description="Set the event identity and visibility before configuring registration details."
                surface="panel"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Title" htmlFor="admin-event-title" required className="sm:col-span-2">
                    <input
                      id="admin-event-title"
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="app-input"
                    />
                  </FormField>
                  <FormField
                    label="Slug"
                    htmlFor="admin-event-slug"
                    helperText="Leave this blank to auto-generate a slug from the title."
                  >
                    <input
                      id="admin-event-slug"
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="Auto-generated"
                      className="app-input"
                    />
                  </FormField>
                  <FormField label="Visibility" htmlFor="admin-event-visibility" required>
                    <ChoiceInput<string>
                      inputId="admin-event-visibility"
                      options={EVENT_VISIBILITY_OPTIONS}
                      value={visibility}
                      onChange={(next) => {
                        if (next != null && !Array.isArray(next)) setVisibility(next);
                      }}
                      listboxLabel="Event visibility"
                    />
                  </FormField>
                </div>
                <div className="max-w-md">
                  <FormField label="Event type" htmlFor="event-calendar-type" required>
                    <ChoiceInput<string>
                      inputId="event-calendar-type"
                      options={EVENT_CALENDAR_CHOICE_OPTIONS}
                      value={calendarTypeId}
                      onChange={(next) => {
                        if (next != null && !Array.isArray(next)) setCalendarTypeId(next);
                      }}
                      listboxLabel="Event type"
                    />
                  </FormField>
                </div>
                <FormCheckbox
                  label="Published"
                  checked={published}
                  onChange={setPublished}
                  helperText="Published events can appear on public or member-facing event lists based on visibility."
                />
              </FormSection>

              {/* Schedule */}
              <FormSection
                title="Schedule"
                description="Timespans are required. Use multiple rows when the event runs across separate sessions."
                surface="panel"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Enter at least one start and end time.
                  </div>
                  <button type="button" onClick={addTimespan} className="text-sm text-primary-teal hover:underline">
                    + Add timespan
                  </button>
                </div>
                {timespans.map((ts, i) => (
                  <div
                    key={i}
                    className={`space-y-3 ${i === 0 ? '' : 'border-t border-gray-200 pt-4 dark:border-gray-700'}`}
                  >
                    {timespans.length > 1 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          Timespan {i + 1}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeTimespan(i)}
                          className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <FormField
                        label="Start"
                        htmlFor={`admin-event-timespan-start-${i}`}
                        required
                      >
                        <input
                          id={`admin-event-timespan-start-${i}`}
                          type="datetime-local"
                          value={ts.startDt}
                          onChange={(e) => updateTimespan(i, 'startDt', e.target.value)}
                          className="app-input"
                          required
                        />
                      </FormField>
                      <FormField
                        label="End"
                        htmlFor={`admin-event-timespan-end-${i}`}
                        required
                      >
                        <input
                          id={`admin-event-timespan-end-${i}`}
                          type="datetime-local"
                          value={ts.endDt}
                          onChange={(e) => updateTimespan(i, 'endDt', e.target.value)}
                          className="app-input"
                          required
                        />
                      </FormField>
                    </div>
                  </div>
                ))}
              </FormSection>

              {/* Locations — pill toggles matching the calendar event form */}
              <FormSection
                title="Locations"
                description="Choose the sheets and any off-ice locations that belong on the event."
                surface="panel"
              >
                <div className="space-y-2">
                  {sheets.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="On ice">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide shrink-0">
                        Sheets
                      </span>
                      {sheets.map((s) => {
                        const selected = selectedSheets.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleSheet(s.id)}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                              selected
                                ? 'bg-primary-teal text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() =>
                          selectedSheets.length === sheets.length
                            ? setSelectedSheets([])
                            : setSelectedSheets(sheets.map((s) => s.id))
                        }
                        className="text-xs text-primary-teal hover:underline shrink-0"
                      >
                        {selectedSheets.length === sheets.length ? 'Unselect all' : 'Select all'}
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Other locations">
                    {LOCATION_OPTIONS.map((opt) => {
                      const selected = selectedFixedLocs.includes(opt.type);
                      return (
                        <button
                          key={opt.type}
                          type="button"
                          onClick={() => toggleFixedLoc(opt.type)}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                            selected
                              ? 'bg-primary-teal text-white'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </FormSection>

              {/* Registration settings */}
              <FormSection
                title="Registration settings"
                description="Use disabled fields only when settings are temporarily unavailable, not as a substitute for hiding irrelevant inputs."
                surface="panel"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    label="Capacity"
                    htmlFor="admin-event-capacity"
                    helperText="Leave this blank if the event should not have a registration cap."
                  >
                    <input
                      id="admin-event-capacity"
                      type="number"
                      min="1"
                      value={capacity}
                      onChange={(e) => setCapacity(e.target.value)}
                      placeholder="Unlimited"
                      className="app-input"
                    />
                  </FormField>
                  <FormField label="Registration fee ($)" htmlFor="admin-event-fee">
                    <input
                      id="admin-event-fee"
                      type="number"
                      min="0"
                      step="0.01"
                      value={feeDollars}
                      onChange={(e) => setFeeDollars(e.target.value)}
                      placeholder="0.00 (free)"
                      className="app-input"
                    />
                  </FormField>
                  <FormField
                    label="Member registration fee ($)"
                    htmlFor="admin-event-member-fee"
                    helperText="If set, logged-in members pay this rate instead of the regular fee."
                  >
                    <input
                      id="admin-event-member-fee"
                      type="number"
                      min="0"
                      step="0.01"
                      value={memberFeeDollars}
                      onChange={(e) => setMemberFeeDollars(e.target.value)}
                      placeholder="Same as regular (leave blank)"
                      className="app-input"
                    />
                  </FormField>
                  <FormField label="Registration opens" htmlFor="admin-event-registration-start">
                    <input
                      id="admin-event-registration-start"
                      type="datetime-local"
                      value={registrationStart}
                      onChange={(e) => setRegistrationStart(e.target.value)}
                      className="app-input"
                    />
                  </FormField>
                  <FormField label="Registration cutoff" htmlFor="admin-event-registration-cutoff">
                    <input
                      id="admin-event-registration-cutoff"
                      type="datetime-local"
                      value={registrationCutoff}
                      onChange={(e) => setRegistrationCutoff(e.target.value)}
                      className="app-input"
                    />
                  </FormField>
                  <FormField label="Cancellation cutoff" htmlFor="admin-event-cancellation-cutoff">
                    <input
                      id="admin-event-cancellation-cutoff"
                      type="datetime-local"
                      value={cancellationCutoff}
                      onChange={(e) => setCancellationCutoff(e.target.value)}
                      className="app-input"
                    />
                  </FormField>
                </div>
                <div className="space-y-3">
                  <FormCheckbox
                    label="Enable waitlist when full"
                    checked={enableWaitlist}
                    onChange={setEnableWaitlist}
                  />
                  <FormCheckbox
                    label="Allow group registration"
                    checked={allowGroupRegistration}
                    onChange={(checked) => {
                      setAllowGroupRegistration(checked);
                      if (checked && registrationFields.length > 0) {
                        setShowScopePrompt(true);
                      } else {
                        setShowScopePrompt(false);
                      }
                      if (!checked) {
                        setRegistrationFields((prev) =>
                          prev.map((f) => ({ ...f, scope: 'group' })),
                        );
                      }
                    }}
                    helperText="Turn this on when one registration can include multiple people."
                  />
                  {allowGroupRegistration && (
                    <FormField
                      label="Max group size"
                      htmlFor="admin-event-max-group-size"
                      className="ml-6 max-w-xs"
                      helperText="Leave this blank if groups should not have a size limit."
                    >
                      <input
                        id="admin-event-max-group-size"
                        type="number"
                        min="2"
                        value={maxGroupSize}
                        onChange={(e) => setMaxGroupSize(e.target.value)}
                        placeholder="No limit"
                        className="app-input"
                      />
                    </FormField>
                  )}
                </div>
              </FormSection>

              {/* Owners */}
              <FormSection
                title="Owners"
                description="Owners can manage the event and registration settings."
                surface="panel"
              >
                {ownerMemberIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {ownerMemberIds.map((mid) => {
                      const m = memberOptions.find((mem) => mem.id === mid);
                      return (
                        <span
                          key={mid}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                        >
                          {m ? m.name : `Member #${mid}`}
                          <button
                            type="button"
                            onClick={() => removeOwner(mid)}
                            className="text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2 items-end max-w-sm">
                  <div className="flex-1">
                    <FormField
                      label="Add owner"
                      helperText="Search for a member who should be able to edit this event."
                    >
                    <MemberAutocomplete
                      value={addingOwner}
                      onChange={setAddingOwner}
                      placeholder="Search members..."
                      filterOption={(option) => !ownerMemberIds.includes(option.id)}
                    />
                    </FormField>
                  </div>
                  <Button type="button" variant="secondary" onClick={addOwner} disabled={addingOwner === ''}>
                    Add
                  </Button>
                </div>
              </FormSection>

              {/* Custom registration fields */}
              <FormSection
                title="Custom registration fields"
                description="Keep labels clear and use required text consistently so the public registration form stays predictable."
                surface="panel"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <div className="relative" ref={addFieldMenuRef}>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setAddFieldMenuOpen((open) => !open)}
                      aria-haspopup="menu"
                      aria-expanded={addFieldMenuOpen}
                      className="gap-2"
                    >
                      Add
                      <HiChevronDown className={`h-4 w-4 transition-transform ${addFieldMenuOpen ? 'rotate-180' : ''}`} />
                    </Button>
                    {addFieldMenuOpen ? (
                      <div
                        role="menu"
                        aria-label="Add registration field"
                        className="absolute left-0 z-20 mt-2 min-w-[18rem] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
                      >
                        <div className="py-1">
                          {presetMenuItems.map((preset) => {
                            const alreadyAdded = registrationFields.some((f) => f.fieldType === preset);
                            return (
                              <button
                                key={preset}
                                type="button"
                                role="menuitem"
                                disabled={alreadyAdded}
                                onClick={() => {
                                  addPreset(preset);
                                  setAddFieldMenuOpen(false);
                                }}
                                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                                  alreadyAdded
                                    ? 'cursor-not-allowed text-gray-400 dark:text-gray-500'
                                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                                }`}
                              >
                                <span>{PRESET_LABELS[preset]}</span>
                                {alreadyAdded ? (
                                  <span className="text-xs text-gray-400 dark:text-gray-500">Added</span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                        <div className="border-t border-gray-200 dark:border-gray-700" />
                        <div className="py-1">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              addField();
                              setAddFieldMenuOpen(false);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                          >
                            Custom field
                          </button>
                        </div>
                        <div className="border-t border-gray-200 dark:border-gray-700" />
                        <div className="py-1">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              addSubheading();
                              setAddFieldMenuOpen(false);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                          >
                            Subheading
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {showScopePrompt && allowGroupRegistration && registrationFields.length > 0 && (
                  <div className="rounded-md border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-3">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      Group registration is now enabled. Please choose whether each custom field applies per group or per person.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowScopePrompt(false)}
                      className="mt-2 text-xs text-amber-700 dark:text-amber-300 hover:underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                <SortableList
                  items={registrationFields}
                  getId={(field) => field.id ?? `row-${field.sortOrder}-${field.label}-${field.fieldType}`}
                  getItemLabel={(field) =>
                    isSubheadingFieldType(field.fieldType)
                      ? 'subheading'
                      : isPresetFieldType(field.fieldType)
                        ? PRESET_LABELS[field.fieldType]
                        : field.label.trim() || 'custom field'
                  }
                  itemNoun="registration field"
                  onReorder={(nextFields) => setRegistrationFields(nextFields)}
                  renderItem={({ item: field, index: i, isDragging, isOverlay, dragHandle }) => (
                    <SortableRow
                      isDragging={isDragging}
                      isOverlay={isOverlay}
                      className="space-y-3 border-gray-200/90 bg-transparent dark:border-gray-700/90"
                    >
                      <div className="flex items-center gap-2">
                        {dragHandle}
                        <div className="flex flex-1 min-w-0 items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {isSubheadingFieldType(field.fieldType)
                              ? 'Subheading'
                              : isPresetFieldType(field.fieldType)
                                ? PRESET_LABELS[field.fieldType]
                                : `Field ${i + 1}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeField(i)}
                            className="shrink-0 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {isSubheadingFieldType(field.fieldType) && (
                        <FormField
                          label="Subheading text"
                          htmlFor={`registration-field-heading-${i}`}
                          required
                          helperText="This displays as section copy on the public registration form."
                        >
                          <input
                            id={`registration-field-heading-${i}`}
                            type="text"
                            placeholder="Heading text shown on the registration form"
                            value={field.label}
                            onChange={(e) => updateField(i, { label: e.target.value })}
                            className="app-input"
                            required
                          />
                        </FormField>
                      )}
                      {isPresetFieldType(field.fieldType) && (
                        <div className="space-y-2">
                          <FormCheckbox
                            label="Required"
                            checked={field.required}
                            onChange={(checked) => updateField(i, { required: checked })}
                          />
                          {allowGroupRegistration && !presetScopeLocked(field.fieldType) && (
                            <FormField
                              label="Field scope"
                              htmlFor={`registration-field-preset-scope-${i}`}
                              helperText="Choose whether this preset appears once per registration or once per person."
                            >
                              <ChoiceInput<string>
                                inputId={`registration-field-preset-scope-${i}`}
                                options={REGISTRATION_SCOPE_OPTIONS}
                                value={field.scope}
                                onChange={(next) => {
                                  if (next != null && !Array.isArray(next))
                                    updateField(i, { scope: next });
                                }}
                                listboxLabel="Field scope"
                                inputClassName={`app-input max-w-xs ${showScopePrompt ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''}`}
                              />
                            </FormField>
                          )}
                        </div>
                      )}
                      {!isSubheadingFieldType(field.fieldType) && !isPresetFieldType(field.fieldType) && (
                        <div className="grid grid-cols-2 gap-3">
                          <FormField
                            label="Label"
                            htmlFor={`registration-field-label-${i}`}
                            required
                            className="col-span-2"
                          >
                            <input
                              id={`registration-field-label-${i}`}
                              type="text"
                              placeholder="Label"
                              value={field.label}
                              onChange={(e) => updateField(i, { label: e.target.value })}
                              className="app-input"
                              required
                            />
                          </FormField>
                          <FormField
                            label="Field type"
                            htmlFor={`registration-field-type-${i}`}
                            className={allowGroupRegistration ? '' : 'col-span-2'}
                          >
                            <ChoiceInput<string>
                              inputId={`registration-field-type-${i}`}
                              options={CUSTOM_FIELD_TYPE_OPTIONS}
                              value={field.fieldType}
                              onChange={(next) => {
                                if (next != null && !Array.isArray(next))
                                  updateField(i, { fieldType: next });
                              }}
                              listboxLabel="Field type"
                            />
                          </FormField>
                          {allowGroupRegistration && (
                            <FormField
                              label="Field scope"
                              htmlFor={`registration-field-scope-${i}`}
                            >
                              <ChoiceInput<string>
                                inputId={`registration-field-scope-${i}`}
                                options={REGISTRATION_SCOPE_OPTIONS}
                                value={field.scope}
                                onChange={(next) => {
                                  if (next != null && !Array.isArray(next))
                                    updateField(i, { scope: next });
                                }}
                                listboxLabel="Field scope"
                                inputClassName={`app-input ${showScopePrompt ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''}`}
                              />
                            </FormField>
                          )}
                          {(field.fieldType === 'dropdown' || field.fieldType === 'radio') && (
                            <FormField
                              label="Options"
                              htmlFor={`registration-field-options-${i}`}
                              helperText="Separate each option with a comma."
                              className="col-span-2"
                            >
                              <input
                                id={`registration-field-options-${i}`}
                                type="text"
                                placeholder="Options (comma-separated)"
                                value={field.options}
                                onChange={(e) => updateField(i, { options: e.target.value })}
                                className="app-input"
                              />
                            </FormField>
                          )}
                          <FormCheckbox
                            label="Required"
                            checked={field.required}
                            onChange={(checked) => updateField(i, { required: checked })}
                            className="col-span-2"
                          />
                        </div>
                      )}
                    </SortableRow>
                  )}
                  renderOverlay={(field) => (
                    <SortableRow isDragging isOverlay className="space-y-3 border-primary-teal/60 bg-white/95 dark:bg-gray-800/95">
                      <div className="flex items-center gap-2">
                        <DragHandle
                          label={`Reorder ${
                            isSubheadingFieldType(field.fieldType)
                              ? 'subheading'
                              : isPresetFieldType(field.fieldType)
                                ? PRESET_LABELS[field.fieldType]
                                : field.label.trim() || 'custom field'
                          }`}
                          disabled
                        />
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {isSubheadingFieldType(field.fieldType)
                            ? 'Subheading'
                            : isPresetFieldType(field.fieldType)
                              ? PRESET_LABELS[field.fieldType]
                              : field.label.trim() || 'Custom field'}
                        </div>
                      </div>
                    </SortableRow>
                  )}
                />
                {registrationFields.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No custom fields configured.</p>
                )}
              </FormSection>

              {/* Actions */}
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-600">
                <Button type="button" variant="secondary" onClick={() => navigate('/admin/events')}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving...' : isNew ? 'Create event' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'details' && !isNew && eventId != null && (
          <AdminEventDetailsArticlePanel
            eventId={eventId}
            eventTitle={title}
            eventSlug={slug}
            articleId={linkedArticleId}
            onArticleIdChange={setLinkedArticleId}
          />
        )}

        {activeTab === 'tournament' && !isNew && eventId != null && isBonspielEvent && (
          <div className="flex min-h-[calc(100dvh-12rem)] flex-1 flex-col">
            <AdminEventTournamentPanel
              eventId={eventId}
              eventTitle={title}
              initialTournamentFormat={tournamentFormat}
              onTournamentFormatChange={setTournamentFormat}
              initialTeamsPublished={tournamentTeamsPublished}
              initialDrawPublished={tournamentDrawPublished}
              onSaved={(teams, draw) => {
                setTournamentTeamsPublished(teams);
                setTournamentDrawPublished(draw);
              }}
            />
          </div>
        )}

        {activeTab === 'registrations' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                {registrationsLoaded ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {activeRegistrationCount} active registration{activeRegistrationCount !== 1 ? 's' : ''}
                  </p>
                ) : (
                  <div className="h-5" />
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Click any registration name to open the full registration page.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={copyRegistrantEmails} disabled={!registrationsLoaded}>
                  Copy registrant emails
                </Button>
                <Button type="button" variant="secondary" onClick={handleOpenExportTsv} disabled={!registrationsLoaded}>
                  Export TSV
                </Button>
                <Button
                  type="button"
                  onClick={() => navigate(`/admin/events/${id}/registrations/new`)}
                >
                  Add registration
                </Button>
              </div>
            </div>

            <div className="max-w-lg">
              <FormField
                label="Search"
                htmlFor="event-registration-search"
                state={!registrationsLoaded ? 'disabled' : 'default'}
                stateMessage={!registrationsLoaded ? 'Registration data is still loading.' : undefined}
              >
                <input
                  id="event-registration-search"
                  type="text"
                  value={registrationSearch}
                  onChange={(e) => setRegistrationSearch(e.target.value)}
                  className="app-input"
                  placeholder="Search all text columns..."
                  disabled={!registrationsLoaded}
                />
              </FormField>
            </div>

            {!registrationsLoaded && showRegistrationsSlowLoader && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                <HiArrowPath className="h-4 w-4 animate-spin" />
                Loading registrations...
              </div>
            )}

            {registrationsLoaded ? (
              <DataTable
                rows={visibleRegistrations}
                rowKey={(registration) => registration.id}
                columns={registrationColumns}
                sort={{ key: registrationSortKey, direction: registrationSortOrder }}
                onSortChange={(sort) => {
                  setRegistrationSortKey(sort.key);
                  setRegistrationSortOrder(sort.direction);
                }}
                actions={{
                  widthClassName: 'w-[7rem]',
                  renderActions: (registration) =>
                    registration.status !== 'cancelled' ? (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(registration)}
                        className="text-red-600 hover:underline dark:text-red-400"
                      >
                        Cancel
                      </button>
                    ) : null,
                }}
                shellClassName="overflow-x-auto"
                emptyState={
                  <AppStateCard
                    compact
                    title={registrations.length === 0 ? 'No registrations yet.' : 'No registrations match your current filters.'}
                  />
                }
                getRowClassName={(registration) => (registration.status === 'cancelled' ? 'opacity-60' : undefined)}
              />
            ) : null}
          </div>
        )}

        {activeTab === 'links' && (
          <div className="space-y-6">
            <div className="app-card-subtle">
              <FormSection
                title="Create special registration link"
                description="Special links can override event defaults for fee, dates, capacity, and group size."
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    label="Label"
                    htmlFor="special-link-label"
                    helperText="Use a short internal label so staff can recognize the purpose of the link."
                  >
                    <input
                      id="special-link-label"
                      type="text"
                      placeholder="e.g. Sponsor invite"
                      value={newLinkLabel}
                      onChange={(e) => setNewLinkLabel(e.target.value)}
                      className="app-input"
                    />
                  </FormField>
                  <FormField
                    label="Registration fee override ($)"
                    htmlFor="special-link-fee"
                    helperText="Leave blank to use the event’s standard registration fee."
                  >
                    <input
                      id="special-link-fee"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Leave blank for default"
                      value={newLinkFee}
                      onChange={(e) => setNewLinkFee(e.target.value)}
                      className="app-input"
                    />
                  </FormField>
                  {allowGroupRegistration ? (
                    <FormField
                      label="Max group size"
                      htmlFor="special-link-max-group-size"
                      helperText="Leave blank to use the event’s default group size."
                    >
                      <input
                        id="special-link-max-group-size"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Leave blank for event default"
                        value={newLinkMaxGroupSize}
                        onChange={(e) => setNewLinkMaxGroupSize(e.target.value)}
                        className="app-input"
                      />
                    </FormField>
                  ) : null}
                </div>
                <div className="space-y-3">
                  <FormCheckbox
                    label="Bypass capacity"
                    checked={newLinkBypassCapacity}
                    onChange={setNewLinkBypassCapacity}
                  />
                  <FormCheckbox
                    label="Ignore registration dates"
                    checked={newLinkIgnoreDates}
                    onChange={setNewLinkIgnoreDates}
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="button" variant="primary" onClick={handleCreateSpecialLink}>
                    Create link
                  </Button>
                </div>
              </FormSection>
            </div>

            {specialLinks.length > 0 ? (
              <DataTable
                rows={specialLinks}
                rowKey={(link) => link.id}
                columns={specialLinkColumns}
                actions={{
                  widthClassName: 'w-[7rem]',
                  renderActions: (link) =>
                    !link.invalidated && !link.used ? (
                      <button
                        type="button"
                        onClick={() => handleInvalidateLink(link.id)}
                        className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Invalidate
                      </button>
                    ) : null,
                }}
              />
            ) : null}

            <Modal isOpen={!!detailLink} onClose={() => setDetailLink(null)} title="Special registration link details" size="sm">
              {detailLink && (
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Label</span>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">{detailLink.label || '(no label)'}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Fee override</span>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                      {detailLink.override_fee_minor !== null
                        ? `$${(detailLink.override_fee_minor / 100).toFixed(2)}`
                        : 'None (uses event default)'}
                    </p>
                  </div>
                  {allowGroupRegistration && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Max group size</span>
                      <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                        {detailLink.max_group_size !== null
                          ? detailLink.max_group_size
                          : 'None (uses event default)'}
                      </p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Bypass capacity</span>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">{detailLink.bypass_capacity ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Ignore registration dates</span>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">{detailLink.ignore_registration_dates ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</span>
                    <p className="text-sm mt-0.5">
                      {detailLink.invalidated ? (
                        <span className="text-red-600 dark:text-red-400">Invalidated</span>
                      ) : detailLink.used ? (
                        <span className="text-gray-600 dark:text-gray-400">Used</span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400">Active</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Created</span>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">{new Date(detailLink.created_at).toLocaleString()}</p>
                  </div>
                </div>
              )}
            </Modal>
          </div>
        )}

        <Modal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          title="Export registrations (TSV)"
          size="xl"
        >
          <div className="flex flex-col h-full min-h-0 space-y-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Copy and paste this into a spreadsheet (tab-separated values).
            </div>
            <FormField
              label="TSV export"
              htmlFor="event-export-tsv"
              state="readonly"
              stateMessage="This export is read-only. Copy it into your spreadsheet tool."
              className="flex-1 min-h-0"
            >
              <textarea
                id="event-export-tsv"
                className="app-input flex-1 min-h-0 font-mono text-xs"
                value={exportTsv}
                readOnly
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsExportModalOpen(false)}>
                Close
              </Button>
              <Button onClick={handleCopyExportTsv}>Copy TSV</Button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={!!teamFieldView}
          onClose={() => setTeamFieldView(null)}
          title={teamFieldView?.field.label?.trim() || 'Team information'}
          size="md"
        >
          {teamFieldView && (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Team roster
                </p>
                <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-line">
                  {formatTeamPresetDisplay(
                    getRegistrationFieldGroupRawValue(teamFieldView.registration, teamFieldView.field),
                    teamFieldView.field.fieldType,
                  ) || '—'}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Link
                  to={`/admin/events/${id}/registrations/${teamFieldView.registration.id}`}
                  className="text-sm text-primary-teal hover:underline"
                  onClick={() => setTeamFieldView(null)}
                >
                  Open full registration
                </Link>
                <Button type="button" variant="secondary" onClick={() => setTeamFieldView(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal
          isOpen={!!cancelTarget}
          onClose={() => {
            if (!cancelBusy) setCancelTarget(null);
          }}
          title="Cancel registration?"
          size="md"
        >
          {cancelTarget && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                This will cancel registration #{cancelTarget.id} for {cancelTarget.contact_name}.
              </p>
              {toMinor(feeDollars) > 0 && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Cancelling this registration will automatically refund the customer.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCancelTarget(null)}
                  disabled={cancelBusy}
                >
                  Keep registration
                </Button>
                {toMinor(feeDollars) > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleCancelRegistration(false)}
                    disabled={cancelBusy}
                  >
                    Cancel without refunding
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => handleCancelRegistration(toMinor(feeDollars) > 0)}
                  disabled={cancelBusy}
                >
                  {cancelBusy ? 'Cancelling...' : toMinor(feeDollars) > 0 ? 'Cancel and refund' : 'Cancel registration'}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </AppPage>
    </Layout>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'bg-green-100 text-green-800 dark:bg-emerald-900/30 dark:text-emerald-200';
    case 'pending_payment':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200';
    case 'waitlisted':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200';
    case 'cancelled':
      return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
}

function formatDateTime24(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day}/${year} ${hours}:${minutes}`;
}

function getRegistrationFieldGroupRawValue(registration: Registration, field: RegistrationField): string {
  const targetFieldId = Number(field.id);
  if (!Number.isFinite(targetFieldId)) return '';
  const values = registration.fieldValues.filter((fv) => {
    const rawFieldId = fv.field_id ?? fv.fieldId;
    return Number(rawFieldId) === targetFieldId;
  });
  if (values.length === 0) return '';
  const groupValue = values.find((fv) => fv.registration_member_id == null) ?? values[0];
  return groupValue?.value ?? '';
}

function isTeamPresetFieldType(fieldType: string): boolean {
  return fieldType === 'preset_team_four' || fieldType === 'preset_team_doubles';
}

function teamPresetPositionLabels(fieldType: string): readonly string[] {
  return fieldType === 'preset_team_doubles' ? TEAM_POSITIONS_DOUBLES : TEAM_POSITIONS_FOUR;
}

function teamFieldTsvHeaders(field: RegistrationField): string[] {
  const positions = teamPresetPositionLabels(field.fieldType);
  const headers: string[] = [];
  for (const pos of positions) {
    headers.push(`${pos} name`, `${pos} email`, `${pos} club`);
  }
  return headers;
}

function teamFieldTsvValues(registration: Registration, field: RegistrationField): string[] {
  const positions = teamPresetPositionLabels(field.fieldType);
  const raw = getRegistrationFieldGroupRawValue(registration, field);
  const emptyRow = (): { name: string; email: string; homeClub: string } => ({
    name: '',
    email: '',
    homeClub: '',
  });
  let parsedRows: Array<{ name: string; email: string; homeClub: string }> = positions.map(() => emptyRow());
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      parsedRows = positions.map((_, i) => {
        const r = parsed[i];
        const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
        return {
          name: typeof o.name === 'string' ? o.name : '',
          email: typeof o.email === 'string' ? o.email : '',
          homeClub: typeof o.homeClub === 'string' ? o.homeClub : '',
        };
      });
    }
  } catch {
    // keep empty rows
  }
  const out: string[] = [];
  for (const row of parsedRows) {
    out.push(row.name, row.email, row.homeClub);
  }
  return out;
}

function formatTeamPresetDisplay(value: string, fieldType: string): string {
  const positions =
    fieldType === 'preset_team_doubles' ? TEAM_POSITIONS_DOUBLES : TEAM_POSITIONS_FOUR;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return value;
    return parsed
      .map((row: unknown, i: number) => {
        const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
        const name = typeof r.name === 'string' ? r.name.trim() : '';
        const email = typeof r.email === 'string' ? r.email.trim() : '';
        const homeClub = typeof r.homeClub === 'string' ? r.homeClub.trim() : '';
        const posLabel = positions[i] ?? `Player ${i + 1}`;
        const nameEmail = [name, email].filter(Boolean).join(' — ');
        const segments = [nameEmail, homeClub ? `Home club: ${homeClub}` : ''].filter(Boolean);
        const line = segments.join(' · ');
        return line ? `${posLabel}: ${line}` : `${posLabel}: —`;
      })
      .join('\n');
  } catch {
    return value;
  }
}

function toTsvCell(value: unknown): string {
  const text = String(value ?? '');
  return text.includes('\t') || text.includes('\n') || text.includes('"')
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function toDateTimeLocal(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  } catch {
    return '';
  }
}
