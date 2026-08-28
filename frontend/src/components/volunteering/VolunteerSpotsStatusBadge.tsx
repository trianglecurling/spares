import {
  volunteerSpotsStatusLabel,
  volunteerSpotsTotals,
} from '../../utils/volunteering';

type VolunteerSpotsStatusBadgeProps = {
  roles: Array<{ volunteersRegistered: number; volunteersNeeded: number }>;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function VolunteerSpotsStatusBadge({ roles }: VolunteerSpotsStatusBadgeProps) {
  const { remaining, needed } = volunteerSpotsTotals(roles);
  const label = volunteerSpotsStatusLabel(remaining, needed);
  const full = remaining <= 0;
  const urgent =
    (remaining === 1 && needed > 1) || (remaining === 2 && needed > 2);

  return (
    <span
      className={joinClasses(
        'inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
        full
          ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
          : urgent
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/70 dark:text-amber-100'
            : 'bg-primary-teal-solid text-white',
      )}
    >
      {label}
    </span>
  );
}
