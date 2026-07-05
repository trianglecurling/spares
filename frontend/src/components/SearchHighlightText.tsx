import { Fragment } from 'react';

type SearchHighlightTextProps = {
  text: string;
  terms: string[];
  className?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function SearchHighlightText({ text, terms, className }: SearchHighlightTextProps) {
  const normalizedTerms = [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))];
  if (!text || normalizedTerms.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const pattern = new RegExp(`(${normalizedTerms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        const isMatch = normalizedTerms.includes(part.toLowerCase());
        if (!isMatch) {
          return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
        }
        return (
          <mark key={`${part}-${index}`} className="rounded bg-amber-100 px-0.5 text-inherit">
            {part}
          </mark>
        );
      })}
    </span>
  );
}
