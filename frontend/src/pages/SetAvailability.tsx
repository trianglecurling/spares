import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import { get, post } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { isLeagueEligibleForSpares } from '../utils/leagueSpareEligibility';

interface League {
  id: number;
  name: string;
  dayOfWeek: number;
  format: string;
  allowsDropIns?: boolean;
  startDate: string;
  endDate: string;
  drawTimes: string[];
}

function leaguePlayFormatUiLabel(format: string): string {
  if (format === 'instructional') return 'Instructional';
  if (format === 'doubles') return 'Doubles';
  return 'Teams';
}

interface Availability {
  leagueId: number;
  available: boolean;
}

export default function SetAvailability() {
  const { member } = useAuth();
  const isSocialMember = Boolean(member?.socialMember);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [canSkip, setCanSkip] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isSocialMember) {
      setLoading(false);
      return;
    }
    loadData();
  }, [isSocialMember]);

  const loadData = async () => {
    try {
      const [leaguesRes, availabilityRes] = await Promise.all([
        get('/leagues', { relevantSession: 'true' }),
        get('/availability'),
      ]);

      setLeagues(leaguesRes.filter((league) => isLeagueEligibleForSpares(league)));
      setAvailability(availabilityRes.leagues);
      setCanSkip(availabilityRes.canSkip);
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
        return prev.map((a) => (a.leagueId === leagueId ? { ...a, available: newValue } : a));
      } else {
        return [...prev, { leagueId, available: newValue }];
      }
    });

    try {
      await post('/availability/league', {
        leagueId,
        available: newValue,
      });
    } catch (error) {
      console.error('Failed to update availability:', error);
      // Revert on error
      setAvailability((prev) =>
        prev.map((a) => (a.leagueId === leagueId ? { ...a, available: currentlyAvailable } : a))
      );
    }
  };

  const handleToggleCanSkip = async (newValue: boolean) => {
    // Optimistically update UI
    setCanSkip(newValue);

    try {
      await post('/availability/can-skip', { canSkip: newValue });
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
        <AppPage narrow>
          <AppStateCard title="Loading sparing availability..." />
        </AppPage>
      </Layout>
    );
  }

  if (isSocialMember) {
    return (
      <Layout>
        <AppPage narrow>
          <AppPageHeader title="Sparing availability" />
          <div className="app-alert border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Your account is a <span className="font-semibold">social membership</span>, which does
            not include ice privileges. You cannot sign up as a spare or change sparing availability.
            If this is a mistake, contact an administrator.
          </div>
        </AppPage>
      </Layout>
    );
  }

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Set your sparing availability"
          description="Let others know when you're available to spare. Your changes are saved automatically."
        />

        <div className="app-card">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="app-section-title">Comfortable skipping?</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Check this if you&apos;re comfortable sparing as a skip
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
          <div className="app-card py-12 text-center">
            <p className="text-gray-600 dark:text-gray-400">
              No leagues have been set up yet. Check back later or contact an administrator.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="app-section-title">
              League availability
            </h2>

            {leagues.map((league) => {
              const available = isAvailable(league.id);

              return (
                <div
                  key={league.id}
                  className={`app-card transition-all border-l-4 ${
                    available ? 'border-l-primary-teal' : 'border-l-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{league.name}</h3>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mt-1 space-y-1">
                        <p>
                          <span className="font-medium dark:text-gray-300">Day:</span>{' '}
                          {getDayName(league.dayOfWeek)}
                        </p>
                        <p>
                          <span className="font-medium dark:text-gray-300">Times:</span>{' '}
                          {league.drawTimes.map(formatTime).join(', ')}
                        </p>
                        <p>
                          <span className="font-medium dark:text-gray-300">Format:</span>{' '}
                          {leaguePlayFormatUiLabel(league.format)}
                        </p>
                      </div>

                      {/* Status text with fixed height container to prevent layout shift */}
                      <div className="h-6 mt-2">
                        <p
                          className={`text-sm text-primary-teal font-medium transition-opacity duration-200 ${
                            available ? 'opacity-100' : 'opacity-0'
                          }`}
                        >
                          ✓ You&apos;re available to spare for this league
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
      </AppPage>
    </Layout>
  );
}
