import type { RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { memberDisplayInitials } from '../utils/memberDisplayCache';
import MemberNavigationPanel from './MemberNavigationPanel';

interface SiteNavAccountControlProps {
  profileMenuOpen: boolean;
  onProfileMenuOpenChange: (open: boolean) => void;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  onNavigate?: () => void;
  /** When true, profile flyout includes full member navigation (public site). */
  showMainNavInProfile?: boolean;
  /** Public pages gate on auth state; member pages always show the avatar menu. */
  variant?: 'public' | 'member';
}

export function SiteNavLoginLink({ className = '', onClick }: { className?: string; onClick?: () => void }) {
  return (
    <Link
      to="/login"
      onClick={onClick}
      className={`ml-1 rounded-md bg-primary-teal-solid px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-teal-solid/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 ${className}`}
    >
      Member login
    </Link>
  );
}

export default function SiteNavAccountControl({
  profileMenuOpen,
  onProfileMenuOpenChange,
  profileMenuRef,
  onNavigate,
  showMainNavInProfile = true,
  variant = 'public',
}: SiteNavAccountControlProps) {
  const { member, memberDisplayName, isLoading, isLikelyAuthenticated } = useAuth();
  const initials = memberDisplayInitials(memberDisplayName ?? member?.name ?? '');

  if (variant === 'public') {
    if (isLoading) return null;

    if (!isLikelyAuthenticated) {
      return <SiteNavLoginLink onClick={onNavigate} />;
    }
  }

  const profileShowsMainNav = variant === 'public' ? showMainNavInProfile : false;

  return (
    <div className="relative ml-2" ref={profileMenuRef}>
      <button
        type="button"
        onClick={() => onProfileMenuOpenChange(!profileMenuOpen)}
        className="rounded-full border border-gray-200 bg-white p-0.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:border-gray-600 dark:bg-gray-800"
        aria-expanded={profileMenuOpen}
        aria-haspopup="true"
        aria-label={`${initials}, account menu`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-teal-solid text-sm font-semibold text-white" aria-hidden>
          {initials}
        </span>
      </button>
      {profileMenuOpen ? (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[13rem] rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <MemberNavigationPanel
            variant="flyout"
            showMainNav={profileShowsMainNav}
            onNavigate={() => {
              onProfileMenuOpenChange(false);
              onNavigate?.();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
