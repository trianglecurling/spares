import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { HiChevronDown } from 'react-icons/hi2';
import usePrefersReducedMotion from './dragDrop/usePrefersReducedMotion';

const PANEL_TRANSITION_MS = 200;
const PANEL_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

export const mobileNavTriggerClass =
  'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-300 dark:hover:bg-gray-700';

export const mobileNavItemClass =
  'block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-300 dark:hover:bg-gray-700';

type AccordionGroupContextValue = {
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
};

const AccordionGroupContext = createContext<AccordionGroupContextValue | null>(null);

export function MobileNavAccordionGroup({
  children,
  className = 'space-y-1',
}: {
  children: ReactNode;
  className?: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const isExpanded = useCallback((id: string) => expandedId === id, [expandedId]);

  const value = useMemo(() => ({ isExpanded, toggle }), [isExpanded, toggle]);

  return (
    <AccordionGroupContext.Provider value={value}>
      <div className={className}>{children}</div>
    </AccordionGroupContext.Provider>
  );
}

function useAccordionGroup() {
  const context = useContext(AccordionGroupContext);
  if (!context) {
    throw new Error('MobileNavAccordionItem must be used within MobileNavAccordionGroup');
  }
  return context;
}

export function MobileNavAccordionPanel({
  expanded,
  children,
  className,
}: {
  expanded: boolean;
  children: ReactNode;
  className?: string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateRows: expanded ? '1fr' : '0fr',
    transition: prefersReducedMotion
      ? 'none'
      : `grid-template-rows ${PANEL_TRANSITION_MS}ms ${PANEL_TRANSITION_EASING}`,
  };

  return (
    <div className={className} style={gridStyle}>
      <div className="min-h-0 overflow-hidden" aria-hidden={!expanded} inert={!expanded}>
        {children}
      </div>
    </div>
  );
}

export function MobileNavAccordionTrigger({
  expanded,
  onToggle,
  level = 0,
  children,
  className = mobileNavTriggerClass,
  triggerRef,
}: {
  expanded: boolean;
  onToggle: () => void;
  level?: number;
  children: ReactNode;
  className?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onToggle}
      className={className}
      style={{ paddingLeft: `${0.75 + level * 0.8}rem` }}
      aria-expanded={expanded}
    >
      <span className="min-w-0 flex-1 text-left">{children}</span>
      <HiChevronDown
        className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${
          expanded ? 'rotate-180' : ''
        }`}
        aria-hidden
      />
    </button>
  );
}

export function MobileNavAccordionItem({
  id,
  label,
  level = 0,
  children,
  panelClassName = 'mt-0.5 space-y-0.5 pl-2',
  nestedGroupClassName = 'space-y-0.5',
}: {
  id: string;
  label: ReactNode;
  level?: number;
  children: ReactNode;
  panelClassName?: string;
  nestedGroupClassName?: string;
}) {
  const { isExpanded, toggle } = useAccordionGroup();
  const expanded = isExpanded(id);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleToggle = () => {
    if (expanded) {
      toggle(id);
      triggerRef.current?.focus();
      return;
    }
    toggle(id);
  };

  return (
    <div>
      <MobileNavAccordionTrigger
        expanded={expanded}
        onToggle={handleToggle}
        level={level}
        triggerRef={triggerRef}
      >
        {label}
      </MobileNavAccordionTrigger>
      <MobileNavAccordionPanel expanded={expanded} className={panelClassName}>
        <MobileNavAccordionGroup className={nestedGroupClassName}>{children}</MobileNavAccordionGroup>
      </MobileNavAccordionPanel>
    </div>
  );
}
