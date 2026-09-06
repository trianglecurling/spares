import type { ReactNode } from 'react';
import {
  distinctGuardianEmail,
  formatEmailWithParent,
  mailtoHrefForMemberEmail,
} from '../utils/memberParentEmail';

type MemberEmailProps = {
  email?: string | null;
  parentEmail?: string | null;
  className?: string;
  mailto?: boolean;
  empty?: ReactNode;
};

export default function MemberEmail({
  email,
  parentEmail,
  className,
  mailto = false,
  empty = null,
}: MemberEmailProps) {
  const trimmed = email?.trim() ?? '';
  if (!trimmed) return <>{empty}</>;
  const parent = distinctGuardianEmail(trimmed, parentEmail);
  const label = formatEmailWithParent(trimmed, parent);
  if (!mailto) {
    return <span className={className}>{label}</span>;
  }
  const href = mailtoHrefForMemberEmail(trimmed, parent);
  if (!href) {
    return <span className={className}>{label}</span>;
  }
  return (
    <a href={href} className={className ?? 'text-primary-teal-link hover:underline'}>
      {label}
    </a>
  );
}
