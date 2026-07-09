import { useEffect, useRef } from 'react';

let isRedirectingFocus = false;

function isFocusableElement(el: HTMLElement, container: HTMLElement): boolean {
  if (!container.contains(el)) return false;

  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  if (el.closest('[aria-hidden="true"], [inert]')) return false;

  return true;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) =>
    isFocusableElement(el, container),
  );
}

export function useFocusTrap(isOpen: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Store the previously focused element
    previousActiveElementRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    container.setAttribute('data-focus-trap', '');

    const focusInitialElement = () => {
      const focusableElements = getFocusableElements(container);
      focusableElements[0]?.focus();
    };

    // Defer initial focus so children that mount after open are included in tab order.
    const focusFrame = requestAnimationFrame(focusInitialElement);

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements(container);
      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const activeIndex = activeElement ? focusableElements.indexOf(activeElement) : -1;

      if (e.shiftKey) {
        if (activeIndex <= 0) {
          e.preventDefault();
          focusableElements[focusableElements.length - 1]?.focus();
        }
      } else if (activeIndex === focusableElements.length - 1) {
        e.preventDefault();
        focusableElements[0]?.focus();
      }
    };

    // Prevent focus from leaving the modal
    const handleFocus = (e: FocusEvent) => {
      if (isRedirectingFocus) return;
      if (!container.contains(e.target as Node)) {
        // Focus moved to another focus trap (e.g. nested modal) - don't fight it
        const otherTrap = (e.target as Element)?.closest?.('[data-focus-trap]');
        if (otherTrap && otherTrap !== container) {
          return;
        }
        isRedirectingFocus = true;
        e.preventDefault();
        getFocusableElements(container)[0]?.focus();
        setTimeout(() => {
          isRedirectingFocus = false;
        }, 0);
      }
    };

    document.addEventListener('keydown', handleTabKey);
    document.addEventListener('focusin', handleFocus);

    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleTabKey);
      document.removeEventListener('focusin', handleFocus);
      container.removeAttribute('data-focus-trap');

      // Restore focus to the previously focused element
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen]);

  return containerRef;
}
