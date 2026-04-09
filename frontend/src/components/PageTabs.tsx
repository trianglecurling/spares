import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type PageTabItem = {
  key: string;
  label: ReactNode;
  isActive: boolean;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
};

type PageTabsProps = {
  items: PageTabItem[];
  className?: string;
  navClassName?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function tabClassName(isActive: boolean, disabled: boolean | undefined): string {
  return joinClasses(
    'pb-3 text-sm font-medium border-b-2 -mb-px transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/30',
    disabled && 'cursor-not-allowed opacity-50',
    isActive
      ? 'border-primary-teal text-primary-teal dark:text-primary-teal'
      : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
  );
}

export default function PageTabs({ items, className, navClassName }: PageTabsProps) {
  if (items.length === 0) return null;

  return (
    <div className={joinClasses('border-b border-gray-200 dark:border-gray-600 mb-6', className)}>
      <nav className={joinClasses('flex flex-wrap gap-4', navClassName)} aria-label="Page sections">
        {items.map((item) => {
          if (item.to) {
            return (
              <Link
                key={item.key}
                to={item.to}
                aria-current={item.isActive ? 'page' : undefined}
                className={tabClassName(item.isActive, item.disabled)}
              >
                {item.label}
              </Link>
            );
          }

          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              disabled={item.disabled}
              aria-pressed={item.isActive}
              className={tabClassName(item.isActive, item.disabled)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
