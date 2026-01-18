import { useState, useEffect, useRef, KeyboardEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import Layout from '../components/Layout';
import api from '../utils/api';
import Button from '../components/Button';
import { HiChevronDown, HiUser, HiUserGroup } from 'react-icons/hi2';
import { format } from 'date-fns';

interface Member {
  id: number;
  name: string;
  email: string | null;
}

interface League {
  id: number;
  name: string;
  dayOfWeek: number; // 0=Sun .. 6=Sat
  format: 'teams' | 'doubles';
  startDate: string;
  endDate: string;
  drawTimes: string[];
}

interface GameSlot {
  date: string;
  time: string;
}

interface SpareRequestPayload {
  leagueId: number;
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  position?: string;
  message?: string;
  requestType: 'public' | 'private';
  invitedMemberIds?: number[];
  ccMemberIds?: number[];
}

export default function RequestSpare() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const navigate = useNavigate();
  const isSpareOnly = Boolean(member?.spareOnly);
  
  // Form State
  const [requestedForMode, setRequestedForMode] = useState<'me' | 'other'>(member?.name ? 'me' : 'other');
  const [otherRequestedForName, setOtherRequestedForName] = useState('');
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [selectedGameSlot, setSelectedGameSlot] = useState<string>(''); // combined "date|time"
  const [position, setPosition] = useState('');
  const [message, setMessage] = useState('');
  const [requestType, setRequestType] = useState<'public' | 'private'>('public');
  const [ccMemberIds, setCcMemberIds] = useState<number[]>([]);

  // Optional section toggles
  const [showPosition, setShowPosition] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [showCc, setShowCc] = useState(false);
  
  // Data State
  const [members, setMembers] = useState<Member[]>([]);
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
  const gameSlotRef = useRef<HTMLSelectElement>(null);
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

  // Autocomplete state
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const positionRef = useRef<HTMLSelectElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // "Someone else" autocomplete state (person who needs the spare)
  const [otherIsDropdownOpen, setOtherIsDropdownOpen] = useState(false);
  const [otherHighlightedIndex, setOtherHighlightedIndex] = useState(-1);
  const otherDropdownRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  // CC autocomplete state
  const [ccSearchTerm, setCcSearchTerm] = useState('');
  const [ccIsDropdownOpen, setCcIsDropdownOpen] = useState(false);
  const [ccHighlightedIndex, setCcHighlightedIndex] = useState(-1);
  const ccDropdownRef = useRef<HTMLDivElement>(null);
  const ccInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSpareOnly) {
      setLoading(false);
      return;
    }
    // Load members and leagues
    const initData = async () => {
      setLoading(true);
      try {
        const [membersRes, leaguesRes] = await Promise.all([
          api.get('/members'),
          api.get('/leagues')
        ]);
        setMembers(membersRes.data.filter((m: Member) => m.id !== member?.id));
        setLeagues(leaguesRes.data);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    initData();
  }, [member?.id, isSpareOnly]);

  // Load upcoming games when league changes
  useEffect(() => {
    if (!selectedLeagueId) {
      setUpcomingGames([]);
      setSelectedGameSlot('');
      return;
    }

    const loadGames = async () => {
      setLoadingGames(true);
      try {
        const response = await api.get(`/leagues/${selectedLeagueId}/upcoming-games`);
        setUpcomingGames(response.data);
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
        const url = `/availability/league/${selectedLeagueId}/members${position ? `?position=${position}` : ''}`;
        const response = await api.get(url);
        setAvailableMembers(response.data);
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
      const clickedInInvites = dropdownRef.current && dropdownRef.current.contains(target);
      const clickedInOther = otherDropdownRef.current && otherDropdownRef.current.contains(target);
      const clickedInCc = ccDropdownRef.current && ccDropdownRef.current.contains(target);
      if (!clickedInInvites) {
        setIsDropdownOpen(false);
      }
      if (!clickedInOther) {
        setOtherIsDropdownOpen(false);
      }
      if (!clickedInCc) {
        setCcIsDropdownOpen(false);
      }
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
    if (isSpareOnly) {
      showAlert('Your account is set to spare-only, so you cannot request a spare.', 'error');
      return;
    }
    setSubmitting(true);

    try {
      const effectiveRequestedForName =
        requestedForMode === 'me'
          ? (member?.name || '').trim()
          : otherRequestedForName.trim();

      if (!effectiveRequestedForName) {
        showAlert('Please enter the name of the person who needs the spare.', 'warning');
        setSubmitting(false);
        return;
      }

      if (!selectedGameSlot) {
        showAlert('Please select a game time', 'warning');
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

      const response = await api.post('/spares', payload);

      if (response.data.notificationsQueued !== undefined) {
        showAlert(
          `Spare request created! ${response.data.notificationsQueued} notification(s) queued. Notifications will be sent gradually.`,
          'success'
        );
      } else {
        showAlert(
          `Spare request created! ${response.data.notificationsSent || 0} notification(s) sent.`,
          'success'
        );
      }
      navigate('/my-requests');
    } catch (error) {
      console.error('Failed to create spare request:', error);
      const responseError = (error as any)?.response?.data?.error;
      const errorMessage =
        typeof responseError === 'string' && responseError.trim()
          ? responseError
          : 'Failed to create spare request. Please try again.';
      showAlert(errorMessage, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const addMember = (memberId: number) => {
    if (!selectedMembers.includes(memberId)) {
      setSelectedMembers([...selectedMembers, memberId]);
    }
    setSearchTerm('');
    setIsDropdownOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  };

  const removeMember = (memberId: number) => {
    setSelectedMembers(selectedMembers.filter((id) => id !== memberId));
  };

  const addCcMember = (memberId: number) => {
    if (ccMemberIds.includes(memberId)) return;
    if (ccMemberIds.length >= 4) return;
    setCcMemberIds([...ccMemberIds, memberId]);
    setCcSearchTerm('');
    setCcIsDropdownOpen(false);
    setCcHighlightedIndex(-1);
    ccInputRef.current?.focus();
  };

  const removeCcMember = (memberId: number) => {
    setCcMemberIds(ccMemberIds.filter((id) => id !== memberId));
  };

  // Filter members for "someone else" autocomplete (match name only, like private invites)
  const otherFilteredMembers = members.filter(
    (m) => m.name.toLowerCase().includes(otherRequestedForName.toLowerCase())
  );

  const ccFilteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(ccSearchTerm.toLowerCase()) &&
      !ccMemberIds.includes(m.id)
  );

  // Filter members for autocomplete
  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !selectedMembers.includes(m.id)
  );

  const handleOtherKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!otherIsDropdownOpen || otherFilteredMembers.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setOtherHighlightedIndex((prev) =>
          prev < otherFilteredMembers.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setOtherHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (otherHighlightedIndex >= 0 && otherHighlightedIndex < otherFilteredMembers.length) {
          setOtherRequestedForName(otherFilteredMembers[otherHighlightedIndex].name);
          setRequestedForMode('other');
          setOtherIsDropdownOpen(false);
          setOtherHighlightedIndex(-1);
        }
        break;
      case 'Escape':
        setOtherIsDropdownOpen(false);
        setOtherHighlightedIndex(-1);
        break;
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen || filteredMembers.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => 
          prev < filteredMembers.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredMembers.length) {
          addMember(filteredMembers[highlightedIndex].id);
        }
        break;
      case 'Escape':
        setIsDropdownOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const handleCcKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!ccIsDropdownOpen || ccFilteredMembers.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setCcHighlightedIndex((prev) =>
          prev < ccFilteredMembers.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setCcHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (ccHighlightedIndex >= 0 && ccHighlightedIndex < ccFilteredMembers.length) {
          addCcMember(ccFilteredMembers[ccHighlightedIndex].id);
        }
        break;
      case 'Escape':
        setCcIsDropdownOpen(false);
        setCcHighlightedIndex(-1);
        break;
    }
  };

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchTerm]);

  useEffect(() => {
    setCcHighlightedIndex(-1);
  }, [ccSearchTerm]);

  // Reset highlight when "someone else" name changes
  useEffect(() => {
    setOtherHighlightedIndex(-1);
  }, [otherRequestedForName]);

  const formatGameSlot = (slot: GameSlot) => {
    const date = new Date(`${slot.date}T${slot.time}`);
    return `${format(date, 'EEEE, MMMM d')} at ${format(date, 'h:mm a')}`;
  };

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const committedLeague = selectedLeagueId
    ? leagues.find((l) => l.id.toString() === selectedLeagueId)
    : undefined;
  const draftLeague = leagueDraftId
    ? leagues.find((l) => l.id.toString() === leagueDraftId)
    : undefined;
  const displayedLeague = leaguePickerOpen ? (draftLeague || committedLeague) : committedLeague;

  const formatTimeShort = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const leaguesByDay: Record<number, League[]> = leagues.reduce((acc, league) => {
    const day = league.dayOfWeek ?? 0;
    (acc[day] ||= []).push(league);
    return acc;
  }, {} as Record<number, League[]>);

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
        : (orderedLeagues.length > 0 ? 0 : -1);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2 text-[#121033] dark:text-gray-100">
            Request a spare
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Fill out the details below to request a spare for your game.
          </p>
        </div>

        {isSpareOnly && (
          <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 rounded-lg p-4">
            Your account is marked as <span className="font-semibold">spare-only</span>, so you can’t create spare requests.
            If this is a mistake, please ask an admin to update your account.
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Person who needs the spare <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-3 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <input
                  type="radio"
                  name="requestedForMode"
                  value="me"
                  checked={requestedForMode === 'me'}
                  onChange={() => {
                    setRequestedForMode('me');
                    setOtherIsDropdownOpen(false);
                  }}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex items-center justify-between gap-2 w-full">
                  <div className="font-medium text-gray-900 dark:text-gray-100">Me</div>
                  {member?.name && (
                    <div className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {member.name}
                    </div>
                  )}
                </div>
              </label>

              <div className="relative" ref={otherDropdownRef}>
                <label
                  className="flex items-center gap-3 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={() => {
                    setRequestedForMode('other');
                    // focus input even if user clicks the radio/label area
                    setTimeout(() => otherInputRef.current?.focus(), 0);
                  }}
                >
                  <input
                    type="radio"
                    name="requestedForMode"
                    value="other"
                    checked={requestedForMode === 'other'}
                    onChange={() => {
                      setRequestedForMode('other');
                      setTimeout(() => otherInputRef.current?.focus(), 0);
                    }}
                    className="mt-0.5"
                  />
                  <input
                    ref={otherInputRef}
                    type="text"
                    value={otherRequestedForName}
                    onChange={(e) => {
                      const next = e.target.value;
                      setOtherRequestedForName(next);
                      // Avoid changing form state just by tabbing into this input.
                      // Only select "Someone else" once the user actually types.
                      if (next.trim().length > 0) {
                        setRequestedForMode('other');
                        setOtherIsDropdownOpen(true);
                      } else {
                        setOtherIsDropdownOpen(false);
                      }
                    }}
                    onFocus={() => {
                      // Do not auto-select "Someone else" just by focusing (e.g. tabbing through the form).
                      // We only open suggestions once there's input (or if already in "other" mode with text).
                      if (requestedForMode === 'other' && otherRequestedForName.trim().length > 0) {
                        setOtherIsDropdownOpen(true);
                      }
                    }}
                    onKeyDown={handleOtherKeyDown}
                    placeholder="Someone else"
                    required={requestedForMode === 'other'}
                    className="w-full bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    disabled={loading}
                    aria-label="Someone else"
                  />
                </label>

                {otherIsDropdownOpen && otherRequestedForName && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {otherFilteredMembers.length > 0 ? (
                      otherFilteredMembers.map((m, index) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setOtherRequestedForName(m.name);
                            setRequestedForMode('other');
                            setOtherIsDropdownOpen(false);
                            setOtherHighlightedIndex(-1);
                          }}
                          onMouseEnter={() => setOtherHighlightedIndex(index)}
                          className={`w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                            index === otherHighlightedIndex ? 'bg-gray-100 dark:bg-gray-700' : ''
                          }`}
                        >
                          <div className="font-medium text-gray-900 dark:text-gray-100">{m.name}</div>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-2 text-gray-500 dark:text-gray-400">
                        No members found
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              You can request a spare for yourself or on behalf of someone else.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
            <div className="flex flex-col h-full">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                League <span className="text-red-500">*</span>
              </label>
              <div className="flex-1 flex items-center">
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
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-left rounded-md focus:outline-none focus:ring-2 focus:ring-primary-teal disabled:opacity-50 flex items-center justify-between gap-3"
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
                        <div className="text-xs text-gray-500 dark:text-gray-300 mt-0.5">
                          {displayedLeague.format === 'teams' ? 'Teams' : 'Doubles'}
                          {displayedLeague.drawTimes?.length ? ` • ${displayedLeague.drawTimes.map(formatTimeShort).join(', ')}` : ''}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-300">Select a league</span>
                    )}
                  </div>
                  <HiChevronDown className={`w-5 h-5 text-gray-500 dark:text-gray-300 shrink-0 transition-transform ${leaguePickerOpen ? 'rotate-180' : ''}`} />
                </button>

                {leaguePickerOpen && (
                  <div
                    className="absolute z-20 mt-2 w-[min(44rem,calc(100vw-2rem))] max-w-[44rem] left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-4"
                    role="dialog"
                    aria-label="Choose a league"
                    onKeyDown={handleLeaguePickerKeyDown}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Choose a league</div>
                      </div>
                      <button
                        type="button"
                        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                        onClick={() => setLeaguePickerOpen(false)}
                      >
                        Close
                      </button>
                    </div>

                    <div ref={leagueDayGridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {dayNames.map((dayName, day) => {
                        const list = dayLists[day] || [];
                        return (
                          <div key={dayName} className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/40 border-b border-gray-200 dark:border-gray-700">
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{dayName}</div>
                            </div>
                            <div className="p-2 space-y-1">
                              {list.length === 0 ? (
                                <div className="text-xs text-gray-500 dark:text-gray-400 px-1 py-2">No leagues</div>
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
                                        // Draft selection while navigating; commit when popover closes
                                        setLeagueDraftId(league.id.toString());
                                      }
                                    }}
                                    onMouseEnter={() => {
                                      const idx = leagueIndexById.get(league.id);
                                      if (idx !== undefined) setLeaguePickerActiveIndex(idx);
                                    }}
                                    className={`w-full text-left px-2 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                                      selectedLeagueId === league.id.toString() || leaguePickerActiveIndex === leagueIndexById.get(league.id)
                                        ? 'bg-gray-100 dark:bg-gray-700'
                                        : ''
                                    }`}
                                  >
                                    <div className="flex items-start gap-2">
                                      <div className="mt-0.5 text-gray-600 dark:text-gray-300">
                                        {league.format === 'teams' ? (
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
                                          {league.format === 'teams' ? 'Teams' : 'Doubles'}
                                          {league.drawTimes?.length ? ` • ${league.drawTimes.map(formatTimeShort).join(', ')}` : ''}
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
                )}
                </div>
              </div>
            </div>

            <div className="flex flex-col h-full">
              <label htmlFor="gameSlot" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Game date & time <span className="text-red-500">*</span>
              </label>
              <div className="flex-1 flex items-center">
                <select
                  ref={gameSlotRef}
                  id="gameSlot"
                  value={selectedGameSlot}
                  onChange={(e) => setSelectedGameSlot(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  required
                  disabled={!selectedLeagueId || loadingGames}
                >
                  <option value="">
                    {loadingGames 
                      ? 'Loading games...' 
                      : !selectedLeagueId 
                        ? 'Select a league first' 
                        : 'Select a game'}
                  </option>
                  {upcomingGames.map((slot) => {
                    const value = `${slot.date}|${slot.time}`;
                    return (
                      <option key={value} value={value}>
                        {formatGameSlot(slot)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          </div>

          {showPosition ? (
            <div>
              <label htmlFor="position" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Position (optional)
              </label>
              <select
                ref={positionRef}
                id="position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              >
                <option value="">Any position</option>
                <option value="lead">Lead</option>
                <option value="second">Second</option>
                <option value="vice">Vice</option>
                <option value="skip">Skip</option>
              </select>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => {
                  setShowPosition(true);
                  setTimeout(() => positionRef.current?.focus(), 0);
                }}
              >
                Specify a position
              </button>
            </div>
          )}

          {showMessage ? (
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Personal message (optional)
              </label>
              <textarea
                ref={messageRef}
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                rows={3}
                placeholder="Any additional details, such as who is on your team, who the opponent is, what are the stakes of this game, etc."
              />
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => {
                  setShowMessage(true);
                  setTimeout(() => messageRef.current?.focus(), 0);
                }}
              >
                Write a personal message
              </button>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Request type <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              <label className="flex items-start p-4 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
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

              <label className="flex items-start p-4 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
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
          </div>

          {requestType === 'private' && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Select members to invite <span className="text-red-500">*</span>
              </label>
              
              {/* Selected Members Pills */}
              <div className="flex flex-wrap gap-2 mb-2">
                {selectedMembers.map(id => {
                  const member = members.find(m => m.id === id);
                  if (!member) return null;
                  return (
                    <div key={id} className="bg-primary-teal text-white text-sm rounded-full px-3 py-1 flex items-center focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-teal">
                      <span>{member.name}</span>
                      <button
                        type="button"
                        onClick={() => removeMember(id)}
                        className="ml-2 hover:text-gray-200 focus:outline-none rounded-full p-0.5"
                        aria-label={`Remove ${member.name}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Autocomplete Input */}
              <div className="relative" ref={dropdownRef}>
                <input
                  ref={inputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setIsDropdownOpen(true);
                  }}
                  onFocus={() => setIsDropdownOpen(true)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  placeholder="Search for members..."
                  disabled={loading}
                />
                
                {isDropdownOpen && searchTerm && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {filteredMembers.length > 0 ? (
                      filteredMembers.map((m, index) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => addMember(m.id)}
                          className={`w-full text-left px-4 py-2 focus:outline-none ${
                            index === highlightedIndex 
                              ? 'bg-gray-100 dark:bg-gray-700' 
                              : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          <div className="font-medium dark:text-gray-100">{m.name}</div>
                          {m.email && <div className="text-xs text-gray-500 dark:text-gray-400">{m.email}</div>}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-2 text-gray-500 dark:text-gray-400 text-sm">
                        No members found
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Available Members Box */}
              {selectedLeagueId && (
                <div className="border border-gray-300 dark:border-gray-600 rounded-md p-4 bg-gray-50 dark:bg-gray-700/50">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Members available during {leagues.find(l => l.id.toString() === selectedLeagueId)?.name || 'this league'}
                  </label>
                  {loadingAvailableMembers ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">Loading...</div>
                  ) : availableMembers.filter(m => !selectedMembers.includes(m.id)).length === 0 ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                      {availableMembers.length === 0 
                        ? 'No members have set availability for this league'
                        : 'All available members have been selected'}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {availableMembers
                        .filter(m => !selectedMembers.includes(m.id))
                        .map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600 hover:border-primary-teal transition-colors"
                          >
                            <div className="flex-1">
                              <div className="font-medium text-sm dark:text-gray-100">{m.name}</div>
                              {m.email && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">{m.email}</div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => addMember(m.id)}
                              className="ml-3 px-3 py-1 bg-primary-teal text-white rounded text-sm hover:bg-opacity-80 transition-colors"
                            >
                              +
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {loading && (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading members...</div>
              )}
            </div>
          )}

          {showCc ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Let your teammates know? (optional)
              </label>

              {ccMemberIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {ccMemberIds.map((id) => {
                    const m = members.find((mem) => mem.id === id);
                    if (!m) return null;
                    return (
                      <div
                        key={id}
                        className="bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm rounded-full px-3 py-1 flex items-center"
                      >
                        <span>{m.name}</span>
                        <button
                          type="button"
                          onClick={() => removeCcMember(id)}
                          className="ml-2 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none rounded-full p-0.5"
                          aria-label={`Remove ${m.name}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="relative" ref={ccDropdownRef}>
                <input
                  ref={ccInputRef}
                  type="text"
                  value={ccSearchTerm}
                  onChange={(e) => {
                    setCcSearchTerm(e.target.value);
                    setCcIsDropdownOpen(true);
                  }}
                  onFocus={() => setCcIsDropdownOpen(true)}
                  onKeyDown={handleCcKeyDown}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  placeholder={ccMemberIds.length >= 4 ? 'CC limit reached (4)' : 'Search for members to CC...'}
                  disabled={loading || ccMemberIds.length >= 4}
                />

                {ccIsDropdownOpen && ccSearchTerm && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {ccFilteredMembers.length > 0 ? (
                      ccFilteredMembers.map((m, index) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => addCcMember(m.id)}
                          className={`w-full text-left px-4 py-2 focus:outline-none ${
                            index === ccHighlightedIndex
                              ? 'bg-gray-100 dark:bg-gray-700'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          <div className="font-medium dark:text-gray-100">{m.name}</div>
                          {m.email && <div className="text-xs text-gray-500 dark:text-gray-400">{m.email}</div>}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-2 text-gray-500 dark:text-gray-400 text-sm">
                        No members found
                      </div>
                    )}
                  </div>
                )}
              </div>

              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                CC up to 4 members. They’ll get a copy of the confirmation and updates.
              </p>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => {
                  setShowCc(true);
                  setTimeout(() => ccInputRef.current?.focus(), 0);
                }}
              >
                Notify your teammates
              </button>
            </div>
          )}

          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting || isSpareOnly} className="flex-1">
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
      </div>
    </Layout>
  );
}
