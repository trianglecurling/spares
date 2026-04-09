import type { ReactNode } from 'react';

type PublicStateTone = 'neutral' | 'error' | 'warning' | 'success';

type PublicStateCardProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: PublicStateTone;
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const toneClasses: Record<PublicStateTone, string> = {
  neutral: 'text-gray-700',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

export default function PublicStateCard({
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: PublicStateCardProps) {
  return (
    <div className={joinClasses('public-card p-6 text-center sm:p-8', toneClasses[tone], className)}>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-balance">{title}</h2>
        {description ? <p className="mx-auto max-w-2xl text-sm leading-relaxed opacity-90">{description}</p> : null}
      </div>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
