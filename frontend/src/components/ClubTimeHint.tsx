import { clubTimeZoneHint } from '../utils/clubTime';
import { useClubTimeZone } from '../contexts/ClubTimeZoneContext';

export default function ClubTimeHint({ className }: { className?: string }) {
  const timeZone = useClubTimeZone();
  return <p className={className ?? 'text-xs text-gray-500 dark:text-gray-400'}>{clubTimeZoneHint(timeZone)}</p>;
}
