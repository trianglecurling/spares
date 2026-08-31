import {
  formatVolunteerDateOnly,
  localDateOnly,
  volunteerCredentialIsValidOn,
} from '../utils/volunteering';

export type MemberCredentialItem = {
  id: number;
  name: string;
  description: string | null;
  expiresAt: string | null;
  systemKey?: string | null;
};

export default function MemberCredentialsList({
  credentials,
}: {
  credentials: MemberCredentialItem[];
}) {
  const today = localDateOnly();
  const sorted = [...credentials].sort((a, b) => {
    const aExpired = !volunteerCredentialIsValidOn(a.expiresAt, today);
    const bExpired = !volunteerCredentialIsValidOn(b.expiresAt, today);
    if (aExpired !== bExpired) return aExpired ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <ul className="space-y-3">
      {sorted.map((credential) => {
        const expired = !volunteerCredentialIsValidOn(credential.expiresAt, today);
        return (
          <li key={credential.id} className="app-card space-y-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="font-medium text-gray-900 dark:text-gray-100">{credential.name}</div>
              <span
                className={
                  expired
                    ? 'inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                }
              >
                {expired ? 'Expired' : 'Current'}
              </span>
            </div>
            {credential.description ? (
              <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
                {credential.description}
              </p>
            ) : null}
            {credential.systemKey ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Granted automatically when you meet this requirement.
              </p>
            ) : credential.expiresAt ? (
              <p
                className={
                  expired
                    ? 'text-sm text-amber-700 dark:text-amber-300'
                    : 'text-sm text-gray-600 dark:text-gray-400'
                }
              >
                {expired ? 'Expired' : 'Expires'} {formatVolunteerDateOnly(credential.expiresAt)}
              </p>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400">No expiration</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
