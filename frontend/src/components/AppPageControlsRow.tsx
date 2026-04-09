import type { ReactNode } from 'react';

type AppPageControlsRowProps = {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function AppPageControlsRow({
  left,
  right,
  className,
}: AppPageControlsRowProps) {
  const hasLeft = Boolean(left);
  const hasRight = Boolean(right);

  return (
    <div
      className={joinClasses(
        'app-card-subtle flex flex-col gap-3 md:flex-row md:items-center md:justify-between',
        className
      )}
    >
      {hasLeft ? <div className="flex flex-wrap items-center gap-3">{left}</div> : null}
      {hasRight ? (
        <div
          className={joinClasses(
            'flex flex-wrap items-center gap-3',
            hasLeft ? 'md:justify-end' : 'md:ml-auto md:justify-end'
          )}
        >
          {right}
        </div>
      ) : null}
    </div>
  );
}
