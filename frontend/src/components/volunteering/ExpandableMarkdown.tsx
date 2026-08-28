import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArticleMarkdown } from '../ArticleMarkdown';

type ExpandableMarkdownProps = {
  markdown: string;
  /** Accessible context for the read more control, typically the program title. */
  title?: string;
  className?: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Renders article markdown clamped to two lines, with a Read more control when the
 * content overflows. Used for volunteer program descriptions on compact surfaces
 * such as the dashboard.
 */
export default function ExpandableMarkdown({ markdown, title, className }: ExpandableMarkdownProps) {
  const trimmed = markdown.trim();
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const update = () => {
      if (expanded) return;
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 0;
      const threshold = Math.max(4, lineHeight * 0.5);
      setCanExpand(el.scrollHeight > el.clientHeight + threshold);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    // Image loads change scrollHeight without resizing the clamped box.
    el.addEventListener('load', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      el.removeEventListener('load', update, true);
    };
  }, [trimmed, expanded]);

  if (!trimmed) return null;

  const showToggle = canExpand || expanded;
  const toggleLabel = expanded ? 'Show less' : 'Read more';
  const toggleAriaLabel = title
    ? expanded
      ? `Show less of ${title}`
      : `Read more about ${title}`
    : toggleLabel;

  return (
    <div className={joinClasses('min-w-0', className)}>
      <ArticleMarkdown
        ref={contentRef}
        id={contentId}
        markdown={trimmed}
        className={joinClasses(
          'markdown-content markdown-content-snippet max-w-none',
          !expanded && 'markdown-snippet-clamp',
        )}
      />
      {showToggle ? (
        <button
          type="button"
          className="mt-1 rounded-sm text-sm font-medium text-primary-teal-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={toggleAriaLabel}
          onClick={(event) => {
            event.preventDefault();
            setExpanded((current) => !current);
          }}
        >
          {toggleLabel}
        </button>
      ) : null}
    </div>
  );
}
