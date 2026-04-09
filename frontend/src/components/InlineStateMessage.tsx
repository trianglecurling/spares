import type { ReactNode } from 'react';

type InlineStateTone = 'neutral' | 'error' | 'warning' | 'success';

type InlineStateMessageProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: InlineStateTone;
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const toneClasses: Record<InlineStateTone, string> = {
  neutral: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200',
};

export default function InlineStateMessage({
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: InlineStateMessageProps) {
  return (
    <div className={joinClasses('rounded-lg border px-4 py-3 text-sm', toneClasses[tone], className)}>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="opacity-90">{description}</p> : null}
      </div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
