import type { MouseEventHandler } from 'react';
import { Link } from 'react-router-dom';
import { HiArrowLeft } from 'react-icons/hi2';

type BackButtonProps = {
  label: string;
  to?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const baseClassName =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-teal/40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700';

export default function BackButton({ label, to, onClick, className }: BackButtonProps) {
  const content = (
    <>
      <HiArrowLeft className="h-4 w-4" />
      <span>{label}</span>
    </>
  );

  if (to) {
    return <Link to={to} className={joinClasses(baseClassName, className)}>{content}</Link>;
  }

  return (
    <button type="button" onClick={onClick} className={joinClasses(baseClassName, className)}>
      {content}
    </button>
  );
}
