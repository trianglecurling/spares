import { useState, useEffect, useRef, KeyboardEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import api from '../utils/api';
import Button from '../components/Button';
import { format } from 'date-fns';

interface Member {
  id: number;
  name: string;
  email: string | null;
}

interface League {
  id: number;
  name: string;
}

interface GameSlot {
  date: string;
  time: string;
}

interface SpareRequestPayload {
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  position?: string;
  message?: string;
  requestType: 'public' | 'private';
  invitedMemberIds?: number[];
}

export default function RequestSpare() {
  const { member } = useAuth();
  const navigate = useNavigate();
  
  // Form State
  const [requestedForName, setRequestedForName] = useState(member?.name || '');
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [selectedGameSlot, setSelectedGameSlot] = useState<string>(''); // combined "date|time"
  const [position, setPosition] = useState('');
  const [message, setMessage] = useState('');
  const [requestType, setRequestType] = useState<'public' | 'private'>('public');
  
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

  // Autocomplete state
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
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
  }, [member?.id]);

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
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (!selectedGameSlot) {
        alert('Please select a game time');
        setSubmitting(false);
        return;
      }

      const [gameDate, gameTime] = selectedGameSlot.split('|');

      const payload: SpareRequestPayload = {
        requestedForName,
        gameDate,
        gameTime,
        position: position || undefined,
        message: message || undefined,
        requestType,
      };

      if (requestType === 'private') {
        if (selectedMembers.length === 0) {
          alert('Please select at least one member for a private request');
          setSubmitting(false);
          return;
        }
        payload.invitedMemberIds = selectedMembers;
      }

      const response = await api.post('/spares', payload);

      if (response.data.notificationsQueued !== undefined) {
        alert(
          `Spare request created! ${response.data.notificationsQueued} notification(s) queued. Notifications will be sent gradually.`
        );
      } else {
        alert(
          `Spare request created! ${response.data.notificationsSent || 0} notification(s) sent.`
        );
      }
      navigate('/my-requests');
    } catch (error) {
      console.error('Failed to create spare request:', error);
      alert('Failed to create spare request. Please try again.');
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

  // Filter members for autocomplete
  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !selectedMembers.includes(m.id)
  );

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

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchTerm]);

  const formatGameSlot = (slot: GameSlot) => {
    const date = new Date(`${slot.date}T${slot.time}`);
    return `${format(date, 'EEEE, MMMM d')} at ${format(date, 'h:mm a')}`;
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#121033' }}>
            Request a spare
          </h1>
          <p className="text-gray-600">
            Fill out the details below to request a spare for your game.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <label htmlFor="requestedForName" className="block text-sm font-medium text-gray-700 mb-2">
              Person who needs the spare <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="requestedForName"
              value={requestedForName}
              onChange={(e) => setRequestedForName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              required
            />
            <p className="text-sm text-gray-500 mt-1">
              Usually yourself, but can be someone else if requesting on their behalf
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="league" className="block text-sm font-medium text-gray-700 mb-2">
                League <span className="text-red-500">*</span>
              </label>
              <select
                id="league"
                value={selectedLeagueId}
                onChange={(e) => setSelectedLeagueId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
                disabled={loading}
              >
                <option value="">Select a league</option>
                {leagues.map((league) => (
                  <option key={league.id} value={league.id}>
                    {league.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="gameSlot" className="block text-sm font-medium text-gray-700 mb-2">
                Game date & time <span className="text-red-500">*</span>
              </label>
              <select
                id="gameSlot"
                value={selectedGameSlot}
                onChange={(e) => setSelectedGameSlot(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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

          <div>
            <label htmlFor="position" className="block text-sm font-medium text-gray-700 mb-2">
              Position (optional)
            </label>
            <select
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
            >
              <option value="">Any position</option>
              <option value="lead">Lead</option>
              <option value="second">Second</option>
              <option value="vice">Vice</option>
              <option value="skip">Skip</option>
            </select>
          </div>

          <div>
            <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
              Personal message (optional)
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
              rows={3}
              placeholder="Any additional details, such as who is on your team, who the opponent is, what are the stakes of this game, etc."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Request type <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              <label className="flex items-start p-4 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="requestType"
                  value="public"
                  checked={requestType === 'public'}
                  onChange={(e) => setRequestType(e.target.value as 'public')}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium">Public</div>
                  <div className="text-sm text-gray-600">
                    Open to all members
                  </div>
                </div>
              </label>

              <label className="flex items-start p-4 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="requestType"
                  value="private"
                  checked={requestType === 'private'}
                  onChange={(e) => setRequestType(e.target.value as 'private')}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium">Private</div>
                  <div className="text-sm text-gray-600">
                    Invite specific members only
                  </div>
                </div>
              </label>
            </div>
          </div>

          {requestType === 'private' && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  placeholder="Search for members..."
                  disabled={loading}
                />
                
                {isDropdownOpen && searchTerm && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {filteredMembers.length > 0 ? (
                      filteredMembers.map((m, index) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => addMember(m.id)}
                          className={`w-full text-left px-4 py-2 focus:outline-none ${
                            index === highlightedIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="font-medium">{m.name}</div>
                          {m.email && <div className="text-xs text-gray-500">{m.email}</div>}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-2 text-gray-500 text-sm">
                        No members found
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Available Members Box */}
              {selectedLeagueId && (
                <div className="border border-gray-300 rounded-md p-4 bg-gray-50">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Members available during {leagues.find(l => l.id.toString() === selectedLeagueId)?.name || 'this league'}
                  </label>
                  {loadingAvailableMembers ? (
                    <div className="text-sm text-gray-500 text-center py-2">Loading...</div>
                  ) : availableMembers.filter(m => !selectedMembers.includes(m.id)).length === 0 ? (
                    <div className="text-sm text-gray-500 text-center py-2">
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
                            className="flex items-center justify-between p-2 bg-white rounded border border-gray-200 hover:border-primary-teal transition-colors"
                          >
                            <div className="flex-1">
                              <div className="font-medium text-sm">{m.name}</div>
                              {m.email && (
                                <div className="text-xs text-gray-500">{m.email}</div>
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
                <div className="text-sm text-gray-500">Loading members...</div>
              )}
            </div>
          )}

          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting} className="flex-1">
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
