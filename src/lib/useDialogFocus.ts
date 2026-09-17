import { useEffect, useRef, type RefObject } from 'react';

/** Keyboard containment, Escape dismissal and restoration for an open dialog. */
export function useDialogFocus(root: RefObject<HTMLElement | null>, dismiss: () => void) {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = root.current;
    if (!dialog) return;
    const buttons = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')];
    buttons()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); latest.current(); }
      if (event.key !== 'Tab') return;
      const items = buttons();
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (!items.length) { event.preventDefault(); return; }
      if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0]?.focus();
      }
    };
    const focus = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) buttons()[0]?.focus(); };
    document.addEventListener('keydown', key);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('focusin', focus);
      if (previous?.isConnected) previous.focus();
    };
  }, [root]);
}
