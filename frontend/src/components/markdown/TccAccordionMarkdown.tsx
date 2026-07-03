import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type DetailsHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type TransitionEvent,
} from 'react';
import { flushSync } from 'react-dom';
import type { ExtraProps } from 'react-markdown';
import usePrefersReducedMotion from '../dragDrop/usePrefersReducedMotion';

const PANEL_TRANSITION_MS = 200;
const PANEL_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

const TccAccordionMarkdownContext = createContext(false);

function isTccAccordionRoot(className?: string): boolean {
  if (!className) return false;
  return className.split(/\s+/).includes('tcc-accordion');
}

function isSummaryElement(child: ReactNode): child is ReactElement<{ onClick?: (event: MouseEvent<HTMLElement>) => void }> {
  return isValidElement(child) && child.type === 'summary';
}

function isPanelElement(child: ReactNode): boolean {
  if (!isValidElement<{ className?: string }>(child)) return false;
  if (child.type !== 'div') return false;
  const className = child.props.className;
  return typeof className === 'string' && className.split(/\s+/).includes('tcc-accordion-panel');
}

function panelAnimationStyle(heightPx: number, animate: boolean): CSSProperties {
  return {
    display: 'block',
    height: `${heightPx}px`,
    overflow: 'hidden',
    padding: 0,
    transition: animate ? `height ${PANEL_TRANSITION_MS}ms ${PANEL_TRANSITION_EASING}` : 'none',
  };
}

function AnimatedTccAccordionDetails({
  className,
  children,
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const [expanded, setExpanded] = useState(false);
  const [panelHeight, setPanelHeight] = useState(0);
  const [animatePanel, setAnimatePanel] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pendingCloseRef = useRef(false);

  const childArray = Children.toArray(children);
  const hasPanel = childArray.some(isPanelElement);

  const measurePanelHeight = () => {
    const panel = detailsRef.current?.querySelector(':scope > .tcc-accordion-panel');
    return panel instanceof HTMLElement ? panel.scrollHeight : 0;
  };

  const panelStyle = panelAnimationStyle(panelHeight, animatePanel);

  const handleSummaryClick = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();

    if (!expanded) {
      pendingCloseRef.current = false;
      flushSync(() => {
        setExpanded(true);
        setAnimatePanel(false);
        setPanelHeight(0);
      });

      requestAnimationFrame(() => {
        const nextHeight = measurePanelHeight();
        setAnimatePanel(true);
        setPanelHeight(nextHeight);
      });
      return;
    }

    pendingCloseRef.current = true;
    const nextHeight = measurePanelHeight();
    flushSync(() => {
      setAnimatePanel(false);
      setPanelHeight(nextHeight);
    });

    requestAnimationFrame(() => {
      setAnimatePanel(true);
      setPanelHeight(0);
    });
  };

  const handlePanelTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== 'height') return;
    if (!event.currentTarget.classList.contains('tcc-accordion-panel')) return;

    if (pendingCloseRef.current) {
      pendingCloseRef.current = false;
      setExpanded(false);
      setAnimatePanel(false);
      setPanelHeight(0);
      return;
    }

    if (expanded) {
      setAnimatePanel(false);
    }
  };

  const enhanceSummary = (
    child: ReactElement<{ onClick?: (event: MouseEvent<HTMLElement>) => void; 'aria-expanded'?: boolean }>
  ) =>
    cloneElement(child, {
      'aria-expanded': expanded,
      onClick: (event: MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event);
        handleSummaryClick(event);
      },
    });

  const enhancePanel = (
    child: ReactElement<{
      className?: string;
      style?: CSSProperties;
      onTransitionEnd?: (event: TransitionEvent<HTMLDivElement>) => void;
    }>
  ) =>
    cloneElement(child, {
      style: { ...child.props.style, ...panelStyle },
      onTransitionEnd: (event: TransitionEvent<HTMLDivElement>) => {
        child.props.onTransitionEnd?.(event);
        handlePanelTransitionEnd(event);
      },
    });

  const detailsProps = {
    ...props,
    ref: detailsRef,
    className,
    open: true as const,
    'data-tcc-expanded': expanded ? 'true' : 'false',
  };

  if (!hasPanel) {
    const summaryChild = childArray.find(isSummaryElement);
    const bodyChildren = childArray.filter((child) => !isSummaryElement(child));

    return (
      <details {...detailsProps}>
        {summaryChild ? enhanceSummary(summaryChild) : null}
        <div className="tcc-accordion-panel" style={panelStyle} onTransitionEnd={handlePanelTransitionEnd}>
          {bodyChildren}
        </div>
      </details>
    );
  }

  return (
    <details {...detailsProps}>
      {childArray.map((child, index) => {
        if (isSummaryElement(child)) {
          return cloneElement(enhanceSummary(child), { key: child.key ?? `summary-${index}` });
        }
        if (isPanelElement(child)) {
          const panelChild = child as ReactElement<{
            className?: string;
            onTransitionEnd?: (event: TransitionEvent<HTMLDivElement>) => void;
          }>;
          return cloneElement(enhancePanel(panelChild), { key: panelChild.key ?? `panel-${index}` });
        }
        return child;
      })}
    </details>
  );
}

export function TccAccordionMarkdownDiv({
  className,
  children,
  node: _node,
  ...props
}: HTMLAttributes<HTMLDivElement> & ExtraProps) {
  if (!isTccAccordionRoot(className)) {
    return (
      <div className={className} {...props}>
        {children}
      </div>
    );
  }

  return (
    <TccAccordionMarkdownContext.Provider value={true}>
      <div className={`${className ?? ''} tcc-accordion--react`.trim()} {...props}>
        {children}
      </div>
    </TccAccordionMarkdownContext.Provider>
  );
}

export function TccAccordionMarkdownDetails({
  className,
  children,
  node: _node,
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement> & ExtraProps) {
  const inAccordion = useContext(TccAccordionMarkdownContext);
  const prefersReducedMotion = usePrefersReducedMotion();

  if (!inAccordion || prefersReducedMotion) {
    return (
      <details className={className} {...props}>
        {children}
      </details>
    );
  }

  return (
    <AnimatedTccAccordionDetails className={className} {...props}>
      {children}
    </AnimatedTccAccordionDetails>
  );
}
