import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HiArrowLeft, HiEye, HiEyeSlash, HiClipboardDocument, HiArrowPath, HiBars3 } from 'react-icons/hi2';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { LOCATION_OPTIONS } from '../calendarEventFormShared';
import {
  CUSTOM_FIELD_TYPES,
  PRESET_FIELD_TYPES,
  PRESET_LABELS,
  isPresetFieldType,
  isSubheadingFieldType,
  presetScopeLocked,
  TEAM_POSITIONS_DOUBLES,
  TEAM_POSITIONS_FOUR,
  type PresetFieldType,
} from '../../utils/eventRegistrationFieldPresets';

interface MemberOption {
  id: number;
  name: string;
  email?: string | null;
}

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

const EVENT_CALENDAR_TYPE_OPTIONS: { id: string; label: string }[] = [
  { id: 'bonspiel', label: 'Bonspiel' },
  { id: 'clinic', label: 'Clinic' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'social', label: 'Social' },
  { id: 'other', label: 'Other' },
];

function toMinor(dollars: string): number {
  const parsed = Number.parseFloat(dollars);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function toDollars(minor: number): string {
  if (!minor) return '';
  return (minor / 100).toFixed(2);
}

function MemberAutocomplete({
  value,
  onChange,
  options,
  placeholder = 'Search members...',
}: {
  value: number | '';
  onChange: (value: number | '') => void;
  options: { id: number; label: string }[];
  placeholder?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.id === value);
  const displayValue = query || selected?.label || '';
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <input
        value={displayValue}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          }
        }}
        placeholder={placeholder}
        className="app-input"
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No matches</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery('');
                }}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminEventEditor() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const isNew = id === 'new';
  const eventId = isNew ? null : parseInt(id || '', 10);
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();

  const validTabs = ['registrations', 'links'] as const;
  type TabKey = 'details' | typeof validTabs[number];
  const activeTab: TabKey = !isNew && tab && (validTabs as readonly string[]).includes(tab)
    ? (tab as TabKey)
    : 'details';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // Members & sheets for pickers
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [sheets, setSheets] = useState<Array<{ id: number; name: string }>>([]);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [calendarTypeId, setCalendarTypeId] = useState('other');
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

  const [showScopePrompt, setShowScopePrompt] = useState(false);

  // Owner picker
  const [addingOwner, setAddingOwner] = useState<number | ''>('');

  const memberOptions = useMemo(
    () => members.map((m) => ({ id: m.id, label: `${m.name}${m.email ? ` (${m.email})` : ''}` })),
    [members],
  );

  const availableOwnerOptions = useMemo(
    () => memberOptions.filter((o) => !ownerMemberIds.includes(o.id)),
    [memberOptions, ownerMemberIds],
  );

  useEffect(() => {
    Promise.all([
      api.get<MemberOption[]>('/members').catch(() => ({ data: [] as MemberOption[] })),
      api.get<Array<{ id: number; name: string; isActive?: boolean }>>('/sheets').catch(() => ({ data: [] as Array<{ id: number; name: string }> })),
    ]).then(([membersRes, sheetsRes]) => {
      setMembers(membersRes.data || []);
      const active = (sheetsRes.data ?? []).filter((s: any) => s.isActive !== false);
      setSheets(active.map((s: any) => ({ id: s.id, name: s.name })));
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
          (e.timespans || []).map((ts: any) => ({
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
        setRegistrationFields(
          (e.registrationFields || [])
            .map((f: any) => ({
              id: f.id,
              label: f.label,
              fieldType: f.field_type,
              scope: f.scope || 'group',
              required: f.required === 1,
              options: f.options || '',
              sortOrder: f.sort_order,
            }))
            .sort((a: RegistrationField, b: RegistrationField) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
        );
      })
      .catch((err) => showAlert(formatApiError(err, 'Failed to load event'), 'error'))
      .finally(() => setLoading(false));
  }, [eventId, isNew]);

  useEffect(() => {
    if (id && tab && !(validTabs as readonly string[]).includes(tab)) {
      navigate(`/admin/events/${id}`, { replace: true });
    }
  }, [id, tab, navigate]);

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

    const payload: any = {
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
  const moveField = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setRegistrationFields((prev) => {
      const next = [...prev];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
  };
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

  const toggleRegistrationSort = (nextKey: string) => {
    if (registrationSortKey === nextKey) {
      setRegistrationSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setRegistrationSortKey(nextKey);
    setRegistrationSortOrder(nextKey === 'date' ? 'desc' : 'asc');
  };

  const registrationSortIndicator = (key: string): string => {
    if (registrationSortKey !== key) return '';
    return registrationSortOrder === 'asc' ? ' ▲' : ' ▼';
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
    : 'Update event details, registrations, and links.';

  const tabs = [
    { key: 'details' as const, label: 'Details' },
    ...(!isNew
      ? [
          { key: 'registrations' as const, label: 'Registrations' },
          { key: 'links' as const, label: 'Special registration links' },
        ]
      : []),
  ];

  return (
    <Layout>
      <AppPage narrow={activeTab !== 'registrations'}>
        <AppPageHeader
          title={pageTitle}
          description={pageSubtitle}
          actions={
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/admin/events')}
              className="inline-flex items-center gap-2"
            >
              <HiArrowLeft className="h-4 w-4" />
              Events
            </Button>
          }
        />

        {tabs.length > 1 && (
          <div className="border-b border-gray-200 dark:border-gray-600 mb-6">
            <nav className="flex gap-4">
              {tabs.map((t) => {
                const to = t.key === 'details'
                  ? `/admin/events/${id}`
                  : `/admin/events/${id}/${t.key}`;
                return (
                  <Link
                    key={t.key}
                    to={to}
                    className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === t.key
                        ? 'border-primary-teal text-primary-teal dark:text-primary-teal'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}

        {activeTab === 'details' && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
            <form onSubmit={handleSave} className="flex flex-col gap-6">
              {/* Basic info */}
              <section className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="app-label">Title</label>
                    <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="app-input" />
                  </div>
                  <div>
                    <label className="app-label">Slug</label>
                    <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Auto-generated" className="app-input" />
                  </div>
                  <div>
                    <label className="app-label">Visibility</label>
                    <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="app-input">
                      <option value="public">Public</option>
                      <option value="active_members">Active members</option>
                      <option value="ice_members">Ice members</option>
                    </select>
                  </div>
                </div>
                <div className="max-w-md">
                  <label className="app-label" htmlFor="event-calendar-type">
                    Event type
                  </label>
                  <select
                    id="event-calendar-type"
                    value={calendarTypeId}
                    onChange={(e) => setCalendarTypeId(e.target.value)}
                    className="app-input"
                  >
                    {EVENT_CALENDAR_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="rounded" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Published</span>
                </label>
              </section>

              {/* Schedule */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="app-label !mb-0">Schedule</label>
                  <button type="button" onClick={addTimespan} className="text-sm text-primary-teal hover:underline">
                    + Add timespan
                  </button>
                </div>
                {timespans.map((ts, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Start</label>
                      <input type="datetime-local" value={ts.startDt} onChange={(e) => updateTimespan(i, 'startDt', e.target.value)} className="app-input" required />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">End</label>
                      <input type="datetime-local" value={ts.endDt} onChange={(e) => updateTimespan(i, 'endDt', e.target.value)} className="app-input" required />
                    </div>
                    {timespans.length > 1 && (
                      <button type="button" onClick={() => removeTimespan(i)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-2">
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </section>

              {/* Locations — pill toggles matching the calendar event form */}
              <section className="space-y-4">
                <label className="app-label !mb-0">Locations</label>
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
              </section>

              {/* Registration settings */}
              <section className="space-y-4">
                <label className="app-label !mb-0">Registration settings</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="app-label">Capacity</label>
                    <input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Unlimited" className="app-input" />
                  </div>
                  <div>
                    <label className="app-label">Registration fee ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={feeDollars}
                      onChange={(e) => setFeeDollars(e.target.value)}
                      placeholder="0.00 (free)"
                      className="app-input"
                    />
                  </div>
                  <div>
                    <label className="app-label">Member registration fee ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={memberFeeDollars}
                      onChange={(e) => setMemberFeeDollars(e.target.value)}
                      placeholder="Same as regular (leave blank)"
                      className="app-input"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      If set, members who are logged in when they register pay this rate instead of the regular fee.
                    </p>
                  </div>
                  <div>
                    <label className="app-label">Registration opens</label>
                    <input type="datetime-local" value={registrationStart} onChange={(e) => setRegistrationStart(e.target.value)} className="app-input" />
                  </div>
                  <div>
                    <label className="app-label">Registration cutoff</label>
                    <input type="datetime-local" value={registrationCutoff} onChange={(e) => setRegistrationCutoff(e.target.value)} className="app-input" />
                  </div>
                  <div>
                    <label className="app-label">Cancellation cutoff</label>
                    <input type="datetime-local" value={cancellationCutoff} onChange={(e) => setCancellationCutoff(e.target.value)} className="app-input" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={enableWaitlist} onChange={(e) => setEnableWaitlist(e.target.checked)} className="rounded" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Enable waitlist when full</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowGroupRegistration}
                      onChange={(e) => {
                        const checked = e.target.checked;
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
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Allow group registration</span>
                  </label>
                  {allowGroupRegistration && (
                    <div className="ml-6">
                      <label className="app-label">Max group size</label>
                      <input type="number" min="2" value={maxGroupSize} onChange={(e) => setMaxGroupSize(e.target.value)} placeholder="No limit" className="app-input w-48" />
                    </div>
                  )}
                </div>
              </section>

              {/* Owners */}
              <section className="space-y-4">
                <label className="app-label !mb-0">Owners</label>
                {ownerMemberIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {ownerMemberIds.map((mid) => {
                      const m = members.find((mem) => mem.id === mid);
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
                    <MemberAutocomplete
                      value={addingOwner}
                      onChange={setAddingOwner}
                      options={availableOwnerOptions}
                      placeholder="Search members..."
                    />
                  </div>
                  <Button type="button" variant="secondary" onClick={addOwner} disabled={addingOwner === ''}>
                    Add
                  </Button>
                </div>
              </section>

              {/* Custom registration fields */}
              <section className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <label className="app-label !mb-0">Custom registration fields</label>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button type="button" onClick={addField} className="text-sm text-primary-teal hover:underline">
                      + Add field
                    </button>
                    <button type="button" onClick={addSubheading} className="text-sm text-primary-teal hover:underline">
                      + Add subheading
                    </button>
                    <select
                      className="app-input text-sm py-1 min-w-[12rem]"
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value as PresetFieldType;
                        if (v) addPreset(v);
                        e.target.value = '';
                      }}
                    >
                      <option value="">+ Add pre-defined field…</option>
                      {PRESET_FIELD_TYPES.filter((pt) => !registrationFields.some((f) => f.fieldType === pt)).map((pt) => (
                        <option key={pt} value={pt}>
                          {PRESET_LABELS[pt]}
                        </option>
                      ))}
                    </select>
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
                {registrationFields.map((field, i) => (
                  <div
                    key={field.id ?? `row-${i}`}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3 bg-gray-50/80 dark:bg-gray-900/30"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                      if (Number.isNaN(from)) return;
                      moveField(from, i);
                    }}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', String(i));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          className="shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing rounded"
                          aria-label="Drag to reorder"
                        >
                          <HiBars3 className="w-5 h-5" />
                        </button>
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
                            className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                        {isSubheadingFieldType(field.fieldType) && (
                          <div>
                            <input
                              type="text"
                              placeholder="Heading text (shown on registration form)"
                              value={field.label}
                              onChange={(e) => updateField(i, { label: e.target.value })}
                              className="app-input"
                              required
                            />
                          </div>
                        )}
                        {isPresetFieldType(field.fieldType) && (
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => updateField(i, { required: e.target.checked })}
                                className="rounded"
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-300">Required</span>
                            </label>
                            {allowGroupRegistration && !presetScopeLocked(field.fieldType) && (
                              <select
                                value={field.scope}
                                onChange={(e) => updateField(i, { scope: e.target.value })}
                                className={`app-input max-w-xs ${showScopePrompt ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''}`}
                              >
                                <option value="group">Per group</option>
                                <option value="individual">Per person</option>
                              </select>
                            )}
                          </div>
                        )}
                        {!isSubheadingFieldType(field.fieldType) && !isPresetFieldType(field.fieldType) && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <input
                                type="text"
                                placeholder="Label"
                                value={field.label}
                                onChange={(e) => updateField(i, { label: e.target.value })}
                                className="app-input"
                                required
                              />
                            </div>
                            <select
                              value={field.fieldType}
                              onChange={(e) => updateField(i, { fieldType: e.target.value })}
                              className={`app-input ${allowGroupRegistration ? '' : 'col-span-2'}`}
                            >
                              {CUSTOM_FIELD_TYPES.map((ft) => (
                                <option key={ft} value={ft}>
                                  {ft}
                                </option>
                              ))}
                            </select>
                            {allowGroupRegistration && (
                              <select
                                value={field.scope}
                                onChange={(e) => updateField(i, { scope: e.target.value })}
                                className={`app-input ${showScopePrompt ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''}`}
                              >
                                <option value="group">Per group</option>
                                <option value="individual">Per person</option>
                              </select>
                            )}
                            {(field.fieldType === 'dropdown' || field.fieldType === 'radio') && (
                              <div className="col-span-2">
                                <input
                                  type="text"
                                  placeholder="Options (comma-separated)"
                                  value={field.options}
                                  onChange={(e) => updateField(i, { options: e.target.value })}
                                  className="app-input"
                                />
                              </div>
                            )}
                            <label className="flex items-center gap-2 cursor-pointer col-span-2">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => updateField(i, { required: e.target.checked })}
                                className="rounded"
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-300">Required</span>
                            </label>
                          </div>
                        )}
                    </div>
                  </div>
                ))}
                {registrationFields.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No custom fields configured.</p>
                )}
              </section>

              {/* Actions */}
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-600">
                <Button type="button" variant="secondary" onClick={() => navigate('/admin/events')}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving…' : isNew ? 'Create event' : 'Save'}
                </Button>
              </div>
            </form>
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
              <label className="app-label !mb-1">Search</label>
              <input
                type="text"
                value={registrationSearch}
                onChange={(e) => setRegistrationSearch(e.target.value)}
                className="app-input"
                placeholder="Search all text columns..."
                disabled={!registrationsLoaded}
              />
            </div>

            {!registrationsLoaded && showRegistrationsSlowLoader && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                <HiArrowPath className="h-4 w-4 animate-spin" />
                Loading registrations...
              </div>
            )}

            {registrationsLoaded && visibleRegistrations.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400">
                {registrations.length === 0 ? 'No registrations yet.' : 'No registrations match your current filters.'}
              </p>
            )}

            {registrationsLoaded && visibleRegistrations.length > 0 && (
              <div className="app-table-shell overflow-x-auto">
                <table className="app-table w-full min-w-[1100px]">
                  <thead className="app-table-head">
                    <tr>
                      <th className="app-table-th text-left whitespace-nowrap">Actions</th>
                      <th
                        className="app-table-th text-left cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleRegistrationSort('date')}
                        title="Sort by registration date/time"
                      >
                        Date{registrationSortIndicator('date')}
                      </th>
                      <th
                        className="app-table-th text-left cursor-pointer select-none"
                        onClick={() => toggleRegistrationSort('name')}
                        title="Sort by registrant name"
                      >
                        Name{registrationSortIndicator('name')}
                      </th>
                      <th className="app-table-th text-left">Email</th>
                      <th
                        className="app-table-th text-center cursor-pointer select-none"
                        onClick={() => toggleRegistrationSort('status')}
                        title="Sort by registration status"
                      >
                        Status{registrationSortIndicator('status')}
                      </th>
                      {allowGroupRegistration && (
                        <th className="app-table-th text-center">Group size</th>
                      )}
                      {registrationFieldsForData.map((field) => (
                        <th
                          key={`field-col-${field.id ?? field.label}`}
                          className={`app-table-th text-left select-none ${field.id ? 'cursor-pointer' : ''}`}
                          onClick={() => {
                            if (!field.id) return;
                            toggleRegistrationSort(`custom:${field.id}`);
                          }}
                          title={`Sort by ${field.label || 'custom field'}`}
                        >
                          {(field.label || '(untitled field)') + (field.id ? registrationSortIndicator(`custom:${field.id}`) : '')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                    {visibleRegistrations.map((reg) => (
                      <tr key={reg.id} className={reg.status === 'cancelled' ? 'opacity-60' : ''}>
                        <td className="app-table-td text-left align-middle">
                          <div className="flex items-center justify-start gap-3">
                            {reg.status !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => setCancelTarget(reg)}
                                className="text-red-600 dark:text-red-400 hover:underline"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="app-table-td text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {formatDateTime24(reg.registered_at)}
                        </td>
                        <td className="app-table-td font-medium text-gray-900 dark:text-gray-100">
                          <Link
                            to={`/admin/events/${id}/registrations/${reg.id}`}
                            className="text-primary-teal hover:underline"
                          >
                            {reg.contact_name}
                          </Link>
                        </td>
                        <td className="app-table-td text-sm text-gray-600 dark:text-gray-400">
                          {reg.contact_email}
                        </td>
                        <td className="app-table-td text-center">
                          <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColor(reg.status)}`}>
                            {reg.status.replace('_', ' ')}
                          </span>
                        </td>
                        {allowGroupRegistration && (
                          <td className="app-table-td text-center">{reg.group_size}</td>
                        )}
                        {registrationFieldsForData.map((field) => {
                          const teamPreset =
                            field.fieldType === 'preset_team_four' ||
                            field.fieldType === 'preset_team_doubles';
                          const cell = getRegistrationFieldValue(reg, field);
                          const teamRaw = teamPreset ? getRegistrationFieldGroupRawValue(reg, field) : '';
                          return (
                            <td
                              key={`field-${reg.id}-${field.id ?? field.label}`}
                              className={`app-table-td text-sm text-gray-600 dark:text-gray-300 min-w-[220px] ${teamPreset ? 'align-middle' : 'align-top'}`}
                            >
                              {teamPreset ? (
                                teamRaw ? (
                                  <button
                                    type="button"
                                    onClick={() => setTeamFieldView({ registration: reg, field })}
                                    className="text-primary-teal hover:underline text-sm font-medium"
                                  >
                                    View
                                  </button>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )
                              ) : cell ? (
                                cell
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'links' && (
          <div className="space-y-6">
            <div className="app-card-subtle space-y-4">
              <h4 className="font-medium text-gray-900 dark:text-gray-100">Create special registration link</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="app-label">Label</label>
                  <input type="text" placeholder="e.g. Sponsor invite" value={newLinkLabel} onChange={(e) => setNewLinkLabel(e.target.value)} className="app-input" />
                </div>
                <div>
                  <label className="app-label">Registration fee override ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Leave blank for default"
                    value={newLinkFee}
                    onChange={(e) => setNewLinkFee(e.target.value)}
                    className="app-input"
                  />
                </div>
                {allowGroupRegistration && (
                  <div>
                    <label className="app-label">Max group size</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Leave blank for event default"
                      value={newLinkMaxGroupSize}
                      onChange={(e) => setNewLinkMaxGroupSize(e.target.value)}
                      className="app-input"
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newLinkBypassCapacity} onChange={(e) => setNewLinkBypassCapacity(e.target.checked)} className="rounded" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Bypass capacity</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newLinkIgnoreDates} onChange={(e) => setNewLinkIgnoreDates(e.target.checked)} className="rounded" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Ignore registration dates</span>
                </label>
              </div>
              <Button type="button" variant="primary" onClick={handleCreateSpecialLink}>
                Create link
              </Button>
            </div>

            {specialLinks.length > 0 && (
              <div className="app-table-shell overflow-x-auto">
                <table className="app-table w-full">
                  <thead className="app-table-head">
                    <tr>
                      <th className="app-table-th text-left">Actions</th>
                      <th className="app-table-th text-left">Label</th>
                      <th className="app-table-th text-left">Link</th>
                      <th className="app-table-th text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                    {specialLinks.map((link) => {
                      const revealed = revealedLinks.has(link.id);
                      const copied = copiedLinkId === link.id;
                      return (
                        <tr key={link.id}>
                          <td className="app-table-td text-left align-top">
                            {!link.invalidated && !link.used && (
                              <button
                                type="button"
                                onClick={() => handleInvalidateLink(link.id)}
                                className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                              >
                                Invalidate
                              </button>
                            )}
                          </td>
                          <td className="app-table-td">
                            <button
                              type="button"
                              onClick={() => setDetailLink(link)}
                              className="text-primary-teal hover:underline font-medium text-left"
                            >
                              {link.label || '(no label)'}
                            </button>
                          </td>
                          <td className="app-table-td text-sm">
                            <div className="flex items-center gap-1.5">
                              {revealed ? (
                                <code className="text-xs break-all bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded select-all">
                                  {getLinkUrl(link)}
                                </code>
                              ) : (
                                <span className="text-xs text-gray-400 dark:text-gray-500 italic">Hidden</span>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleRevealLink(link.id)}
                                className="shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                                title={revealed ? 'Hide link' : 'Reveal link'}
                              >
                                {revealed ? <HiEyeSlash className="h-4 w-4" /> : <HiEye className="h-4 w-4" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => copyLinkUrl(link)}
                                className={`shrink-0 p-1 rounded ${copied ? 'text-green-600 dark:text-green-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                                title={copied ? 'Copied!' : 'Copy link'}
                              >
                                <HiClipboardDocument className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                          <td className="app-table-td text-center">
                            {link.invalidated ? (
                              <span className="text-xs text-red-600 dark:text-red-400">Invalidated</span>
                            ) : link.used ? (
                              <span className="text-xs text-gray-600 dark:text-gray-400">Used</span>
                            ) : (
                              <span className="text-xs text-green-600 dark:text-green-400">Active</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

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
            <textarea
              className="app-input flex-1 min-h-0 font-mono text-xs"
              value={exportTsv}
              readOnly
            />
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
