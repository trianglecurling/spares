import type { ReactNode } from 'react';

type AppStateCardProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function AppStateCard({
  title,
  description,
  action,
  className,
  compact = false,
}: AppStateCardProps) {
  return (
    <div
      className={joinClasses(
        compact ? 'py-8 text-center' : 'app-card py-12 text-center',
        'text-gray-500 dark:text-gray-400',
        className
      )}
    >
      <div className="space-y-2">
        <p className="text-base font-medium text-gray-700 dark:text-gray-300">{title}</p>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
