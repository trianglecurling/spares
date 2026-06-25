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
import type { ExtraProps } from 'react-markdown';
import usePrefersReducedMotion from '../dragDrop/usePrefersReducedMotion';

const PANEL_TRANSITION_MS = 200;

const TccAccordionMarkdownContext = createContext(false);

type PanelHeight = number | 'auto';

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

function panelHeightStyle(height: PanelHeight, animate: boolean): CSSProperties {
  return {
    '--tcc-accordion-panel-height': height === 'auto' ? 'auto' : `${height}px`,
    '--tcc-accordion-panel-transition': animate ? `height ${PANEL_TRANSITION_MS}ms ease` : 'none',
  } as CSSProperties;
}

function AnimatedTccAccordionDetails({
  className,
  children,
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const [open, setOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState<PanelHeight>(0);
  const [animatePanel, setAnimatePanel] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pendingCloseRef = useRef(false);

  const childArray = Children.toArray(children);
  const hasPanel = childArray.some(isPanelElement);

  const getPanel = () =>
    detailsRef.current?.querySelector(':scope > .tcc-accordion-panel') as HTMLDivElement | null;

  const handleSummaryClick = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();

    if (!open) {
      pendingCloseRef.current = false;
      setOpen(true);
      setAnimatePanel(false);
      setPanelHeight(0);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const panel = getPanel();
          if (!panel) return;
          setAnimatePanel(true);
          setPanelHeight(panel.scrollHeight);
        });
      });
      return;
    }

    const panel = getPanel();
    if (!panel) return;

    pendingCloseRef.current = true;
    setAnimatePanel(true);
    setPanelHeight(panel.scrollHeight);
    requestAnimationFrame(() => {
      setPanelHeight(0);
    });
  };

  const handlePanelTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== 'height') return;
    if (!event.currentTarget.classList.contains('tcc-accordion-panel')) return;

    if (pendingCloseRef.current) {
      pendingCloseRef.current = false;
      setOpen(false);
      setAnimatePanel(false);
      setPanelHeight(0);
      return;
    }

    if (open) {
      setAnimatePanel(false);
      setPanelHeight('auto');
    }
  };

  const detailsStyle = panelHeightStyle(panelHeight, animatePanel);

  const enhanceSummary = (
    child: ReactElement<{ onClick?: (event: MouseEvent<HTMLElement>) => void }>
  ) =>
    cloneElement(child, {
      onClick: (event: MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event);
        handleSummaryClick(event);
      },
    });

  const enhancePanel = (
    child: ReactElement<{
      className?: string;
      onTransitionEnd?: (event: TransitionEvent<HTMLDivElement>) => void;
    }>
  ) =>
    cloneElement(child, {
      onTransitionEnd: (event: TransitionEvent<HTMLDivElement>) => {
        child.props.onTransitionEnd?.(event);
        handlePanelTransitionEnd(event);
      },
    });

  if (!hasPanel) {
    const summaryChild = childArray.find(isSummaryElement);
    const bodyChildren = childArray.filter((child) => !isSummaryElement(child));

    return (
      <details
        ref={detailsRef}
        className={className}
        open={open}
        style={detailsStyle}
        {...props}
      >
        {summaryChild ? enhanceSummary(summaryChild) : null}
        <div className="tcc-accordion-panel" onTransitionEnd={handlePanelTransitionEnd}>
          {bodyChildren}
        </div>
      </details>
    );
  }

  return (
    <details ref={detailsRef} className={className} open={open} style={detailsStyle} {...props}>
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
