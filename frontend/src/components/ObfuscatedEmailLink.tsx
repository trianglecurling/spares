import { Link } from 'react-router-dom';

const AT_SIGN = '\u0040';

export function splitEmailAddress(email: string): { local: string; domain: string } | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf(AT_SIGN);
  if (at <= 0 || at === trimmed.length - 1) return null;
  return { local: trimmed.slice(0, at), domain: trimmed.slice(at + 1) };
}

type ObfuscatedEmailLinkProps = {
  localPart: string;
  domain: string;
  className?: string;
};

/**
 * Renders a visible email address without a harvester-friendly `mailto:` href or a single
 * contiguous address string in the DOM. The link goes to the public contact page.
 */
export default function ObfuscatedEmailLink({ localPart, domain, className }: ObfuscatedEmailLinkProps) {
  const local = localPart.trim();
  const host = domain.trim();

  if (!local || !host) return null;

  return (
    <Link to="/contact" className={className}>
      {local}
      <span aria-hidden="true">{AT_SIGN}</span>
      {host}
    </Link>
  );
}
