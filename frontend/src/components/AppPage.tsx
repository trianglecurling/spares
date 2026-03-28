import type { ReactNode } from 'react';

type AppPageProps = {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
};

type AppPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function AppPage({ children, narrow = false, className }: AppPageProps) {
  return <div className={joinClasses(narrow ? 'app-page-narrow' : 'app-page', className)}>{children}</div>;
}

export function AppPageHeader({ title, description, actions, className }: AppPageHeaderProps) {
  return (
    <header className={joinClasses('app-page-header', className)}>
      <div className="space-y-2">
        <h1 className="app-page-title">{title}</h1>
        {description ? <p className="app-page-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
