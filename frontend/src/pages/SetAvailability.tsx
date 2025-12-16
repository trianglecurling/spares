import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';

interface League {
  id: number;
  name: string;
  dayOfWeek: number;
  format: string;
  startDate: string;
  endDate: string;
  drawTimes: string[];
}

interface Availability {
  leagueId: number;
  available: boolean;
}

export default function SetAvailability() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [canSkip, setCanSkip] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [leaguesRes, availabilityRes] = await Promise.all([
        api.get('/leagues'),
        api.get('/availability'),
      ]);

      setLeagues(leaguesRes.data);
      setAvailability(availabilityRes.data.leagues);
      setCanSkip(availabilityRes.data.canSkip);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLeague = async (leagueId: number, currentlyAvailable: boolean) => {
    const newValue = !currentlyAvailable;

    // Optimistically update UI
    setAvailability((prev) => {
      const existing = prev.find((a) => a.leagueId === leagueId);
      if (existing) {
        return prev.map((a) =>
          a.leagueId === leagueId ? { ...a, available: newValue } : a
        );
      } else {
        return [...prev, { leagueId, available: newValue }];
      }
    });

    try {
      await api.post('/availability/league', {
        leagueId,
        available: newValue,
      });
    } catch (error) {
      console.error('Failed to update availability:', error);
      // Revert on error
      setAvailability((prev) =>
        prev.map((a) =>
          a.leagueId === leagueId ? { ...a, available: currentlyAvailable } : a
        )
      );
    }
  };

  const handleToggleCanSkip = async (newValue: boolean) => {
    // Optimistically update UI
    setCanSkip(newValue);

    try {
      await api.post('/availability/can-skip', { canSkip: newValue });
    } catch (error) {
      console.error('Failed to update can skip:', error);
      // Revert on error
      setCanSkip(!newValue);
    }
  };

  const isAvailable = (leagueId: number) => {
    return availability.find((a) => a.leagueId === leagueId)?.available || false;
  };

  const getDayName = (dayOfWeek: number) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek];
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-[#121033] dark:text-gray-100">
            Set your sparing availability
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Let others know when you're available to spare. Your changes are saved automatically.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg dark:text-gray-100">Comfortable skipping?</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Check this if you're comfortable sparing as a skip
              </p>
            </div>
            <button
              onClick={() => handleToggleCanSkip(!canSkip)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                canSkip ? 'bg-primary-teal' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  canSkip ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {leagues.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">
              No leagues have been set up yet. Check back later or contact an administrator.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-[#121033] dark:text-gray-100">
              League availability
            </h2>

            {leagues.map((league) => {
              const available = isAvailable(league.id);

              return (
                <div
                  key={league.id}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-all border-l-4 ${
                    available ? 'border-l-primary-teal' : 'border-l-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg dark:text-gray-100">{league.name}</h3>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mt-1 space-y-1">
                        <p>
                          <span className="font-medium dark:text-gray-300">Day:</span> {getDayName(league.dayOfWeek)}
                        </p>
                        <p>
                          <span className="font-medium dark:text-gray-300">Times:</span>{' '}
                          {league.drawTimes.map(formatTime).join(', ')}
                        </p>
                        <p>
                          <span className="font-medium dark:text-gray-300">Format:</span>{' '}
                          {league.format === 'teams' ? 'Teams' : 'Doubles'}
                        </p>
                      </div>
                      
                      {/* Status text with fixed height container to prevent layout shift */}
                      <div className="h-6 mt-2">
                        <p 
                          className={`text-sm text-primary-teal font-medium transition-opacity duration-200 ${
                            available ? 'opacity-100' : 'opacity-0'
                          }`}
                        >
                          ✓ You're available to spare for this league
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleLeague(league.id, available)}
                      className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                        available ? 'bg-primary-teal' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                          available ? 'translate-x-7' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
