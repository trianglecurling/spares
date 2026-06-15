import { useState, useEffect, useRef, useMemo, KeyboardEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { AppPage, AppPageHeader } from '../components/AppPage';
import MemberAutocomplete from '../components/MemberAutocomplete';
import MemberMultiSelect from '../components/MemberMultiSelect';
import FormField from '../components/FormField';
import FormSection from '../components/FormSection';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';
import { get, post } from '../api/client';
import { formatApiError } from '../utils/api';
import Button from '../components/Button';
import { HiChevronDown, HiUser, HiUserGroup } from 'react-icons/hi2';
import { format } from 'date-fns';

function leaguePlayFormatUiLabel(format: string): string {
  if (format === 'instructional') return 'Instructional';
  if (format === 'doubles') return 'Doubles';
  return 'Teams';
}

interface Member {
  id: number;
  name: string;
  email?: string | null;
}

interface League {
  id: number;
  name: string;
  dayOfWeek: number; // 0=Sun .. 6=Sat
  format: 'teams' | 'doubles' | 'instructional';
  startDate: string;
  endDate: string;
  drawTimes: string[];
}

interface GameSlot {
  date: string;
  time: string;
}

type PositionOption = 'lead' | 'second' | 'vice' | 'skip' | '';

const POSITION_CHOICES: ChoiceOption<Exclude<PositionOption, ''>>[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'second', label: 'Second' },
  { value: 'vice', label: 'Vice' },
  { value: 'skip', label: 'Skip' },
];

interface SpareRequestPayload {
  leagueId: number;
  requestedForName: string;
  requestedForMemberId?: number;
  gameDate: string;
  gameTime: string;
  position?: Exclude<PositionOption, ''>;
  message?: string;
  requestType: 'public' | 'private';
  invitedMemberIds?: number[];
  ccMemberIds?: number[];
  allowDuplicate?: boolean;
}

export default function RequestSpare() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const isSpareOnly = Boolean(member?.spareOnly);
  const isSocialMember = Boolean(member?.socialMember);
  const cannotCreateSpareRequest = isSpareOnly || isSocialMember;

  // Form State
  const [requestedForMode, setRequestedForMode] = useState<'me' | 'other'>(
    member?.name ? 'me' : 'other'
  );
  const [otherRequestedForName, setOtherRequestedForName] = useState('');
  const [otherRequestedForMemberId, setOtherRequestedForMemberId] = useState<number | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [selectedGameSlot, setSelectedGameSlot] = useState<string>(''); // combined "date|time"
  const [position, setPosition] = useState<PositionOption>('');
  const [message, setMessage] = useState('');
  const [requestType, setRequestType] = useState<'public' | 'private'>('public');
  const [ccMemberIds, setCcMemberIds] = useState<number[]>([]);

  // Optional section toggles
  const [showPosition, setShowPosition] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [showCc, setShowCc] = useState(false);

  // Data State
  const [leagues, setLeagues] = useState<League[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<GameSlot[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [availableMembers, setAvailableMembers] = useState<Member[]>([]);

  // UI State
  const [loading, setLoading] = useState(false);
  const [loadingGames, setLoadingGames] = useState(false);
  const [loadingAvailableMembers, setLoadingAvailableMembers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaguePickerOpen, setLeaguePickerOpen] = useState(false);
  const leaguePickerRef = useRef<HTMLDivElement>(null);
  const leagueTriggerRef = useRef<HTMLButtonElement>(null);
  const [leaguePickerActiveIndex, setLeaguePickerActiveIndex] = useState<number>(-1);
  const leagueOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const leagueDayGridRef = useRef<HTMLDivElement>(null);
  const [leagueDraftId, setLeagueDraftId] = useState<string>(''); // draft selection while popover is open
  const leagueDraftIdRef = useRef<string>('');
  const selectedLeagueIdRef = useRef<string>('');

  useEffect(() => {
    leagueDraftIdRef.current = leagueDraftId;
  }, [leagueDraftId]);

  useEffect(() => {
    selectedLeagueIdRef.current = selectedLeagueId;
  }, [selectedLeagueId]);

  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (cannotCreateSpareRequest) {
      setLoading(false);
      return;
    }
    // Load leagues
    const initData = async () => {
      setLoading(true);
      try {
        setLeagues(await get('/leagues', { relevantSession: 'true', summary: 'true' }));
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    initData();
  }, [member?.id, cannotCreateSpareRequest]);

  // Load upcoming games when league changes
  useEffect(() => {
    if (!selectedLeagueId) {
      setUpcomingGames([]);
      setSelectedGameSlot('');
      return;
    }

    const loadGames = async () => {
      setLoadingGames(true);
      setSelectedGameSlot('');
      try {
        const response = await get('/leagues/{id}/upcoming-games', undefined, {
          id: String(selectedLeagueId),
        });
        setUpcomingGames(response);
      } catch (error) {
        console.error('Failed to load upcoming games:', error);
      } finally {
        setLoadingGames(false);
      }
    };

    loadGames();
  }, [selectedLeagueId]);

  // Load available members when league changes, request type is private, or position changes
  useEffect(() => {
    if (!selectedLeagueId || requestType !== 'private') {
      setAvailableMembers([]);
      return;
    }

    const loadAvailableMembers = async () => {
      setLoadingAvailableMembers(true);
      try {
        const response = await get(
          '/availability/league/{leagueId}/members',
          position ? { position } : undefined,
          { leagueId: String(selectedLeagueId) }
        );
        setAvailableMembers(response);
      } catch (error) {
        console.error('Failed to load available members:', error);
      } finally {
        setLoadingAvailableMembers(false);
      }
    };

    loadAvailableMembers();
  }, [selectedLeagueId, requestType, position]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (leaguePickerRef.current && !leaguePickerRef.current.contains(target)) {
        // Close + commit draft selection
        setLeaguePickerOpen(false);
        const draft = leagueDraftIdRef.current;
        const committed = selectedLeagueIdRef.current;
        if (draft && draft !== committed) {
          setSelectedLeagueId(draft);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Close league picker on Escape
  useEffect(() => {
    if (!leaguePickerOpen) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLeaguePickerOpen(false);
        const draft = leagueDraftIdRef.current;
        const committed = selectedLeagueIdRef.current;
        if (draft && draft !== committed) {
          setSelectedLeagueId(draft);
        }
        setTimeout(() => leagueTriggerRef.current?.focus(), 0);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [leaguePickerOpen]);

  // Keep "Me" mode aligned with current member name
  useEffect(() => {
    if (requestedForMode === 'me' && member?.name) {
      // No-op for state, but ensures new member data flows into submission
    }
  }, [requestedForMode, member?.name]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (cannotCreateSpareRequest) {
      showAlert(
        isSocialMember
          ? 'Social memberships do not include spare requests.'
          : 'Your account is set to spare-only, so you cannot request a spare.',
        'error'
      );
      return;
    }
    setSubmitting(true);

    try {
      const effectiveRequestedForName =
        requestedForMode === 'me' ? (member?.name || '').trim() : otherRequestedForName.trim();

      if (!effectiveRequestedForName) {
        showAlert(
          requestedForMode === 'other'
            ? 'Please select the member who needs the spare.'
            : 'Please enter the name of the person who needs the spare.',
          'warning'
        );
        setSubmitting(false);
        return;
      }

      if (!selectedGameSlot) {
        showAlert('Please select a game time', 'warning');
        setSubmitting(false);
        return;
      }
      const isSelectedGameSlotValid = upcomingGames.some(
        (slot) => `${slot.date}|${slot.time}` === selectedGameSlot
      );
      if (!isSelectedGameSlotValid) {
        showAlert('Please select a valid game time for the chosen league.', 'warning');
        setSubmitting(false);
        return;
      }
      if (!selectedLeagueId) {
        showAlert('Please select a league', 'warning');
        setSubmitting(false);
        return;
      }

      const [gameDate, gameTime] = selectedGameSlot.split('|');

      const payload: SpareRequestPayload = {
        leagueId: Number(selectedLeagueId),
        requestedForName: effectiveRequestedForName,
        requestedForMemberId:
          requestedForMode === 'other' ? (otherRequestedForMemberId ?? undefined) : undefined,
        gameDate,
        gameTime,
        position: position || undefined,
        message: message || undefined,
        requestType,
      };

      if (ccMemberIds.length > 0) {
        payload.ccMemberIds = ccMemberIds;
      }

      if (requestType === 'private') {
        if (selectedMembers.length === 0) {
          showAlert('Please select at least one member for a private request', 'warning');
          setSubmitting(false);
          return;
        }
        payload.invitedMemberIds = selectedMembers;
      }

      let response = await post('/spares', payload);

      if ('duplicate' in response && response.duplicate) {
        setSubmitting(false);
        const details = formatDuplicateDetails({
          ...response.existingRequest,
          leagueName: response.existingRequest.leagueName ?? undefined,
        });
        const confirmed = await confirm({
          title: 'Warning: Duplicate spare request',
          message: `A duplicate spare request already exists for ${details}. Did you already create this request (or did someone create it for you)? Creating another will result in 2 spare requests.\n\nWould you like to create a duplicate spare request?`,
          confirmText: 'Create duplicate',
          cancelText: 'Cancel',
          variant: 'warning',
        });
        if (!confirmed) {
          return;
        }
        setSubmitting(true);
        response = await post('/spares', { ...payload, allowDuplicate: true });
      }

      if ('notificationsQueued' in response && response.notificationsQueued !== undefined) {
        const mode = response.notificationMode === 'immediate' ? 'immediately' : 'gradually';
        showAlert(
          `Spare request created! ${response.notificationsQueued} notification(s) queued. Notifications will be sent ${mode}.`,
          'success'
        );
      } else {
        showAlert(
          `Spare request created! ${'notificationsSent' in response ? response.notificationsSent || 0 : 0} notification(s) sent.`,
          'success'
        );
      }
      navigate('/my-requests');
    } catch (error) {
      console.error('Failed to create spare request:', error);
      showAlert(formatApiError(error, 'Failed to create spare request'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const addMember = (memberId: number) => {
    if (selectedMembers.includes(memberId)) return;
    setSelectedMembers([...selectedMembers, memberId]);
  };

  const formatGameSlot = (slot: GameSlot) => {
    const date = new Date(`${slot.date}T${slot.time}`);
    return `${format(date, 'EEEE, MMMM d')} at ${format(date, 'h:mm a')}`;
  };

  const gameSlotOptions = useMemo(
    () =>
      upcomingGames.map((slot) => ({
        value: `${slot.date}|${slot.time}`,
        label: formatGameSlot(slot),
      })),
    [upcomingGames]
  );

  const gameSlotPlaceholder = loadingGames
    ? 'Loading games...'
    : !selectedLeagueId
      ? 'Select a league first'
      : 'Select a game';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const committedLeague = selectedLeagueId
    ? leagues.find((l) => l.id.toString() === selectedLeagueId)
    : undefined;
  const draftLeague = leagueDraftId
    ? leagues.find((l) => l.id.toString() === leagueDraftId)
    : undefined;
  const displayedLeague = leaguePickerOpen ? draftLeague || committedLeague : committedLeague;

  const formatTimeShort = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDuplicateDetails = (details?: {
    requestedForName?: string;
    leagueName?: string;
    gameDate?: string;
    gameTime?: string;
  }) => {
    if (!details) return 'the same game slot';
    const parts: string[] = [];
    if (details.requestedForName) {
      parts.push(details.requestedForName);
    }
    if (details.leagueName) {
      parts.push(details.leagueName);
    }
    if (details.gameDate && details.gameTime) {
      const date = new Date(`${details.gameDate}T${details.gameTime}`);
      if (!Number.isNaN(date.getTime())) {
        parts.push(`${format(date, 'EEEE, MMMM d')} at ${format(date, 'h:mm a')}`);
      }
    }
    return parts.length > 0 ? parts.join(' • ') : 'the same game slot';
  };

  const leaguesByDay: Record<number, League[]> = leagues.reduce(
    (acc, league) => {
      const day = league.dayOfWeek ?? 0;
      (acc[day] ||= []).push(league);
      return acc;
    },
    {} as Record<number, League[]>
  );

  const dayLists: League[][] = dayNames.map((_, day) =>
    (leaguesByDay[day] || []).slice().sort((a, b) => a.name.localeCompare(b.name))
  );

  const orderedLeagues: League[] = dayLists.flatMap((list) => list);

  const leagueIndexById = new Map<number, number>(orderedLeagues.map((l, i) => [l.id, i]));
  const leaguePosById = new Map<number, { day: number; idx: number }>();
  for (let day = 0; day < dayLists.length; day++) {
    for (let idx = 0; idx < dayLists[day].length; idx++) {
      leaguePosById.set(dayLists[day][idx].id, { day, idx });
    }
  }

  // When opening the picker, focus the selected league (or the first league)
  useEffect(() => {
    if (!leaguePickerOpen) return;
    const draftId = leagueDraftId || selectedLeagueId;
    const initialIndex =
      draftId && leagueIndexById.has(Number(draftId))
        ? (leagueIndexById.get(Number(draftId)) as number)
        : orderedLeagues.length > 0
          ? 0
          : -1;
    setLeaguePickerActiveIndex(initialIndex);
    if (!leagueDraftId && draftId) {
      setLeagueDraftId(draftId);
    }
    // Focus after the popover mounts
    setTimeout(() => {
      if (initialIndex >= 0) {
        leagueOptionRefs.current[initialIndex]?.focus();
      }
    }, 0);
  }, [leaguePickerOpen]);

  // Keep refs array in sync with rendered options
  useEffect(() => {
    leagueOptionRefs.current = new Array(orderedLeagues.length).fill(null);
  }, [orderedLeagues.length]);

  const getDayGridColumnCount = (): number => {
    const el = leagueDayGridRef.current;
    if (!el) return 1;
    const template = globalThis.getComputedStyle(el).gridTemplateColumns;
    const cols = template.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  };

  const focusLeagueByGlobalIndex = (index: number) => {
    const league = orderedLeagues[index];
    if (!league) return;
    setLeaguePickerActiveIndex(index);
    // Draft selection while navigating; commit when popover closes
    setLeagueDraftId(league.id.toString());
    setTimeout(() => leagueOptionRefs.current[index]?.focus(), 0);
  };

  const getActiveLeague = (): League | null => {
    const league = orderedLeagues[leaguePickerActiveIndex];
    return league || null;
  };

  const moveLeagueInGrid = (direction: 'up' | 'down' | 'left' | 'right') => {
    const current = getActiveLeague();
    if (!current) return;
    const pos = leaguePosById.get(current.id);
    if (!pos) return;

    const cols = getDayGridColumnCount();
    const row = Math.floor(pos.day / cols);
    const col = pos.day % cols;

    const pick = (day: number, idx: number) => {
      const list = dayLists[day] || [];
      if (list.length === 0) return;
      const clampedIdx = Math.min(Math.max(0, idx), list.length - 1);
      const target = list[clampedIdx];
      const globalIdx = leagueIndexById.get(target.id);
      if (globalIdx !== undefined) {
        focusLeagueByGlobalIndex(globalIdx);
      }
    };

    if (direction === 'down') {
      // Within a day, down moves through leagues. If at end of day, move to next day in same column and go to first league.
      const list = dayLists[pos.day] || [];
      if (pos.idx + 1 < list.length) {
        pick(pos.day, pos.idx + 1);
        return;
      }
      let nextDay = pos.day + cols;
      while (nextDay < 7 && (dayLists[nextDay]?.length ?? 0) === 0) nextDay += cols;
      if (nextDay < 7) pick(nextDay, 0);
      return;
    }

    if (direction === 'up') {
      // Within a day, up moves through leagues. If at start of day, move to previous day in same column and go to last league.
      if (pos.idx > 0) {
        pick(pos.day, pos.idx - 1);
        return;
      }
      let prevDay = pos.day - cols;
      while (prevDay >= 0 && (dayLists[prevDay]?.length ?? 0) === 0) prevDay -= cols;
      if (prevDay >= 0) {
        const prevList = dayLists[prevDay] || [];
        pick(prevDay, prevList.length - 1);
      }
      return;
    }

    if (direction === 'right') {
      // Move to the next day column in the same row (preserve league index when possible)
      for (let c = col + 1; c < cols; c++) {
        const day = row * cols + c;
        if (day >= 7) break;
        if ((dayLists[day]?.length ?? 0) > 0) {
          pick(day, pos.idx);
          return;
        }
      }
      return;
    }

    if (direction === 'left') {
      for (let c = col - 1; c >= 0; c--) {
        const day = row * cols + c;
        if (day < 0) break;
        if ((dayLists[day]?.length ?? 0) > 0) {
          pick(day, pos.idx);
          return;
        }
      }
      return;
    }
  };

  const selectLeagueByIndex = (index: number) => {
    const league = orderedLeagues[index];
    if (!league) return;
    setLeagueDraftId(league.id.toString());
    setLeaguePickerOpen(false);
    if (league.id.toString() !== selectedLeagueId) {
      setSelectedLeagueId(league.id.toString());
    }
    // Return focus to trigger for screen readers / keyboard users
    setTimeout(() => leagueTriggerRef.current?.focus(), 0);
  };

  const handleLeaguePickerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!leaguePickerOpen) return;

    if (e.key === 'Tab') {
      // Requirement: Tab should dismiss the popover but keep focus on the dropdown trigger
      setLeaguePickerOpen(false);
      e.preventDefault();
      // Commit last-focused draft selection
      if (leagueDraftId && leagueDraftId !== selectedLeagueId) {
        setSelectedLeagueId(leagueDraftId);
      }
      setTimeout(() => leagueTriggerRef.current?.focus(), 0);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveLeagueInGrid('down');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveLeagueInGrid('up');
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveLeagueInGrid('right');
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveLeagueInGrid('left');
      return;
    }
    if (e.key === 'Home') {
      if (orderedLeagues.length === 0) return;
      e.preventDefault();
      focusLeagueByGlobalIndex(0);
      return;
    }
    if (e.key === 'End') {
      if (orderedLeagues.length === 0) return;
      e.preventDefault();
      const last = orderedLeagues.length - 1;
      focusLeagueByGlobalIndex(last);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (leaguePickerActiveIndex < 0) return;
      e.preventDefault();
      selectLeagueByIndex(leaguePickerActiveIndex);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setLeaguePickerOpen(false);
      if (leagueDraftId && leagueDraftId !== selectedLeagueId) {
        setSelectedLeagueId(leagueDraftId);
      }
      setTimeout(() => leagueTriggerRef.current?.focus(), 0);
      return;
    }
  };

  return (
    <>
      <AppPage narrow>
        <AppPageHeader title="Request a spare" description="Fill out the details below to request a spare for your game." />

        {isSpareOnly && (
          <div className="app-alert border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
            Your account is marked as <span className="font-semibold">spare-only</span>, so you
            can’t create spare requests. If this is a mistake, please ask an admin to update your
            account.
          </div>
        )}
        {isSocialMember && !isSpareOnly && (
          <div className="app-alert border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Your account is a <span className="font-semibold">social membership</span>, which does
            not include spare requests. If this is a mistake, ask an administrator to update your
            account.
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="app-card p-6 space-y-8"
        >
          <FormSection
            title="Request details"
            description="Choose who needs the spare and which game the request applies to."
          >
            <FormField
              label="Person who needs the spare"
              required
              helperText="You can request a spare for yourself or on behalf of someone else."
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-md border border-gray-300 px-4 py-2 cursor-pointer hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50">
                  <input
                    type="radio"
                    name="requestedForMode"
                    value="me"
                    checked={requestedForMode === 'me'}
                    onChange={() => {
                      setRequestedForMode('me');
                      setOtherRequestedForName('');
                      setOtherRequestedForMemberId(null);
                    }}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex items-center justify-between gap-2 w-full">
                    <div className="font-medium text-gray-900 dark:text-gray-100">Me</div>
                    {member?.name ? (
                      <div className="truncate text-sm text-gray-600 dark:text-gray-400">
                        {member.name}
                      </div>
                    ) : null}
                  </div>
                </label>

                <div className="space-y-2 rounded-md border border-gray-300 px-4 py-3 dark:border-gray-600">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="requestedForMode"
                      value="other"
                      checked={requestedForMode === 'other'}
                      onChange={() => {
                        setRequestedForMode('other');
                      }}
                      className="mt-0.5"
                    />
                    <span className="text-gray-900 dark:text-gray-100">Someone else</span>
                  </label>
                  <MemberAutocomplete
                    value={otherRequestedForMemberId ?? ''}
                    onChange={(nextValue) => {
                      if (nextValue === '') {
                        setOtherRequestedForName('');
                        setOtherRequestedForMemberId(null);
                        return;
                      }
                      setOtherRequestedForMemberId(nextValue);
                    }}
                    onSelectOption={(option) => {
                      setRequestedForMode('other');
                      setOtherRequestedForName(option.name);
                      setOtherRequestedForMemberId(option.id);
                    }}
                    placeholder="Search members by name"
                    minQueryLength={1}
                    noMatchesText="No members found"
                    disabled={loading || requestedForMode !== 'other'}
                    filterOption={(option) => option.id !== member?.id}
                  />
                </div>
              </div>
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 items-stretch">
              <FormField label="League" required>
                <div className="relative w-full" ref={leaguePickerRef}>
                  <button
                    ref={leagueTriggerRef}
                    type="button"
                    onClick={() => setLeaguePickerOpen((v) => !v)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (!leaguePickerOpen) {
                          setLeaguePickerOpen(true);
                        }
                      }
                    }}
                    disabled={loading}
                    className="app-input flex items-center justify-between gap-3 text-left"
                    aria-haspopup="dialog"
                    aria-expanded={leaguePickerOpen}
                  >
                    <div className="min-w-0">
                      {displayedLeague ? (
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words leading-snug">
                              {displayedLeague.name}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-200 shrink-0">
                              {dayNames[displayedLeague.dayOfWeek]}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-300">
                            {leaguePlayFormatUiLabel(displayedLeague.format)}
                            {displayedLeague.drawTimes?.length
                              ? ` • ${displayedLeague.drawTimes.map(formatTimeShort).join(', ')}`
                              : ''}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-300">Select a league</span>
                      )}
                    </div>
                    <HiChevronDown
                      className={`w-5 h-5 text-gray-500 dark:text-gray-300 shrink-0 transition-transform ${leaguePickerOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {leaguePickerOpen ? (
                    <div
                      className="absolute left-0 z-20 mt-2 w-[min(44rem,calc(100vw-2rem))] max-w-[44rem] rounded-lg border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800"
                      role="dialog"
                      aria-label="Choose a league"
                      onKeyDown={handleLeaguePickerKeyDown}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          Choose a league
                        </div>
                        <button
                          type="button"
                          className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                          onClick={() => setLeaguePickerOpen(false)}
                        >
                          Close
                        </button>
                      </div>

                      <div
                        ref={leagueDayGridRef}
                        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                      >
                        {dayNames.map((dayName, day) => {
                          const list = dayLists[day] || [];
                          return (
                            <div
                              key={dayName}
                              className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700"
                            >
                              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-700/40">
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {dayName}
                                </div>
                              </div>
                              <div className="space-y-1 p-2">
                                {list.length === 0 ? (
                                  <div className="px-1 py-2 text-xs text-gray-500 dark:text-gray-400">
                                    No leagues
                                  </div>
                                ) : (
                                  list.map((league) => (
                                    <button
                                      key={league.id}
                                      type="button"
                                      onClick={() => {
                                        setLeagueDraftId(league.id.toString());
                                        setLeaguePickerOpen(false);
                                        if (league.id.toString() !== selectedLeagueId) {
                                          setSelectedLeagueId(league.id.toString());
                                        }
                                      }}
                                      ref={(el) => {
                                        const idx = leagueIndexById.get(league.id);
                                        if (idx !== undefined) leagueOptionRefs.current[idx] = el;
                                      }}
                                      onFocus={() => {
                                        const idx = leagueIndexById.get(league.id);
                                        if (idx !== undefined) {
                                          setLeaguePickerActiveIndex(idx);
                                          setLeagueDraftId(league.id.toString());
                                        }
                                      }}
                                      onMouseEnter={() => {
                                        const idx = leagueIndexById.get(league.id);
                                        if (idx !== undefined) setLeaguePickerActiveIndex(idx);
                                      }}
                                      className={`w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                        selectedLeagueId === league.id.toString() ||
                                        leaguePickerActiveIndex === leagueIndexById.get(league.id)
                                          ? 'bg-gray-100 dark:bg-gray-700'
                                          : ''
                                      }`}
                                    >
                                      <div className="flex items-start gap-2">
                                        <div className="mt-0.5 text-gray-600 dark:text-gray-300">
                                          {league.format !== 'doubles' ? (
                                            <HiUserGroup className="w-4 h-4" />
                                          ) : (
                                            <HiUser className="w-4 h-4" />
                                          )}
                                        </div>
                                        <div className="min-w-0">
                                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words leading-snug">
                                            {league.name}
                                          </div>
                                          <div className="text-xs text-gray-500 dark:text-gray-400">
                                            {leaguePlayFormatUiLabel(league.format)}
                                            {league.drawTimes?.length
                                              ? ` • ${league.drawTimes.map(formatTimeShort).join(', ')}`
                                              : ''}
                                          </div>
                                        </div>
                                      </div>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </FormField>

              <FormField
                label="Game date and time"
                htmlFor="gameSlot"
                required
                state={!selectedLeagueId || loadingGames ? 'disabled' : 'default'}
                stateMessage={
                  !selectedLeagueId
                    ? 'Select a league first.'
                    : loadingGames
                      ? 'Loading available games...'
                      : undefined
                }
              >
                {({ describedBy, invalid }) => (
                  <ChoiceInput<string>
                    inputId="gameSlot"
                    options={gameSlotOptions}
                    value={selectedGameSlot || null}
                    onChange={(next) => setSelectedGameSlot(typeof next === 'string' ? next : '')}
                    placeholder={gameSlotPlaceholder}
                    listboxLabel="Game date and time"
                    required
                    disabled={!selectedLeagueId || loadingGames}
                    loading={loadingGames}
                    ariaDescribedBy={describedBy}
                    ariaInvalid={invalid}
                  />
                )}
              </FormField>
            </div>
          </FormSection>

          <FormSection
            title="Request preferences"
            description="Add optional context and decide who can respond."
          >
                       {showPosition ? (
              <FormField label="Position" htmlFor="position" optional>
                <ChoiceInput<Exclude<PositionOption, ''>>
                  inputId="position"
                  options={POSITION_CHOICES}
                  value={position === '' ? null : position}
                  onChange={(next) =>
                    setPosition(
                      next == null || Array.isArray(next) ? '' : (next as PositionOption)
                    )
                  }
                  placeholder="Any position"
                  listboxLabel="Position"
                  clearButton={{
                    visible: position !== '',
                    label: 'Use any position',
                    onClear: () => setPosition(''),
                  }}
                />
              </FormField>
            ) : (
              <div>
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => {
                    setShowPosition(true);
                    setTimeout(() => document.getElementById('position')?.focus(), 0);
                  }}
                >
                  Specify a position
                </button>
              </div>
            )}

            {showMessage ? (
              <FormField label="Personal message" htmlFor="message" optional>
                <textarea
                  ref={messageRef}
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="app-input"
                  rows={3}
                  placeholder="Any additional details, such as who is on your team, who the opponent is, or what makes this game important."
                />
              </FormField>
            ) : (
              <div>
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => {
                    setShowMessage(true);
                    setTimeout(() => messageRef.current?.focus(), 0);
                  }}
                >
                  Write a personal message
                </button>
              </div>
            )}

            <FormField
              label="Request type"
              required
              helperText="Public requests are visible to all eligible members. Private requests only notify the members you choose."
            >
              <div className="space-y-2">
                <label className="flex items-start rounded-md border border-gray-300 p-4 cursor-pointer hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50">
                  <input
                    type="radio"
                    name="requestType"
                    value="public"
                    checked={requestType === 'public'}
                    onChange={(e) => setRequestType(e.target.value as 'public')}
                    className="mt-1 mr-3"
                  />
                  <div>
                    <div className="font-medium dark:text-gray-100">Public</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Open to all members
                    </div>
                  </div>
                </label>

                <label className="flex items-start rounded-md border border-gray-300 p-4 cursor-pointer hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50">
                  <input
                    type="radio"
                    name="requestType"
                    value="private"
                    checked={requestType === 'private'}
                    onChange={(e) => setRequestType(e.target.value as 'private')}
                    className="mt-1 mr-3"
                  />
                  <div>
                    <div className="font-medium dark:text-gray-100">Private</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Invite specific members only
                    </div>
                  </div>
                </label>
              </div>
            </FormField>

            {requestType === 'private' ? (
              <FormField
                label="Select members to invite"
                required
                helperText="Only invited members can claim a private request."
              >
                <>
                  <MemberMultiSelect
                    selectedIds={selectedMembers}
                    onChange={setSelectedMembers}
                    placeholder="Search for members..."
                    disabled={loading}
                    noMatchesText="No members found"
                    filterOption={(option) => option.id !== member?.id}
                  />

                  {selectedLeagueId ? (
                    <div className="mt-3 rounded-md border border-gray-300 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-700/50">
                      <div className="app-label mb-3">
                        Members available during{' '}
                        {leagues.find((l) => l.id.toString() === selectedLeagueId)?.name ||
                          'this league'}
                      </div>
                      {loadingAvailableMembers ? (
                        <div className="py-2 text-center text-sm text-gray-500 dark:text-gray-400">
                          Loading...
                        </div>
                      ) : availableMembers.filter((m) => !selectedMembers.includes(m.id)).length ===
                        0 ? (
                        <div className="py-2 text-center text-sm text-gray-500 dark:text-gray-400">
                          {availableMembers.length === 0
                            ? 'No members have set availability for this league'
                            : 'All available members have been selected'}
                        </div>
                      ) : (
                        <div className="max-h-48 space-y-2 overflow-y-auto">
                          {availableMembers
                            .filter((m) => !selectedMembers.includes(m.id))
                            .map((m) => (
                              <div
                                key={m.id}
                                className="flex items-center justify-between rounded border border-gray-200 bg-white p-2 transition-colors hover:border-primary-teal dark:border-gray-600 dark:bg-gray-800"
                              >
                                <div className="flex-1">
                                  <div className="text-sm font-medium dark:text-gray-100">
                                    {m.name}
                                  </div>
                                  {m.email ? (
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {m.email}
                                    </div>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => addMember(m.id)}
                                  className="ml-3 rounded bg-primary-teal px-3 py-1 text-sm text-white transition-colors hover:bg-opacity-80"
                                >
                                  +
                                </button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              </FormField>
            ) : null}

            {showCc ? (
              <FormField
                label="Let your teammates know?"
                optional
                helperText="CC up to 4 members. They’ll get a copy of the confirmation and updates."
              >
                <MemberMultiSelect
                  selectedIds={ccMemberIds}
                  onChange={setCcMemberIds}
                  placeholder="Search for members to notify..."
                  disabled={loading}
                  maxSelections={4}
                  noMatchesText="No members found"
                  filterOption={(option) => option.id !== member?.id}
                />
              </FormField>
            ) : (
              <div>
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => setShowCc(true)}
                >
                  Notify your teammates
                </button>
              </div>
            )}
          </FormSection>

          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting || cannotCreateSpareRequest} className="flex-1">
              {submitting ? 'Submitting...' : 'Submit request'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(-1)}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </AppPage>
    </>
  );
}
