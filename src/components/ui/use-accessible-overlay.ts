'use client';

import { useEffect, useRef, type RefObject } from 'react';

const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
const visible = (element: HTMLElement) => element.getClientRects().length > 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]') && !element.matches(':disabled');

/** Keep modal focus local and restore the opener without changing field markup or editing behavior. */
export function useDialogAccessibility(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, preserveInitialFocus = false) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Native inert isolates the background without rewriting any descendant controls.
    const background = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && !node.contains(dialog) && !node.matches('script, style'));
    const previousInert = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    const frame = requestAnimationFrame(() => {
      if (!preserveInitialFocus && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    });
    const keydown = (event: KeyboardEvent) => {
      if (preserveInitialFocus) return;
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => visible(element) && element.tabIndex >= 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    return () => {
      cancelAnimationFrame(frame);
      dialog.removeEventListener('keydown', keydown);
      background.forEach((node, index) => { node.inert = previousInert[index]; });
      if (opener?.isConnected && visible(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, ref, preserveInitialFocus]);
}

/** Add button-based popup navigation while leaving search fields and editors untouched. */
export function usePopupKeyboard(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, context?: unknown) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    const popup = root.matches('[role="menu"], [role="listbox"]') ? root : root.querySelector<HTMLElement>('[role="menu"], [role="listbox"]');
    if (!popup) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let focusedInside = false;
    let dismissedWithTab = false;
    const items = () => Array.from(popup.querySelectorAll<HTMLElement>('[role^="menuitem"], [role="option"]')).filter(element => visible(element) && element.getAttribute('aria-disabled') !== 'true');
    const frame = requestAnimationFrame(() => {
      // Preserve autofocus on searchable selectors and avoid taking focus from an editor.
      if (!root.contains(document.activeElement) || !document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) (items().find(item => item.getAttribute('aria-selected') === 'true' || item.getAttribute('aria-checked') === 'true') || items()[0])?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], .cm-editor, .xterm')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); opener?.focus(); return; }
      if (event.key === 'Tab') { dismissedWithTab = true; close.current(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const options = items();
      if (!options.length) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[index]?.focus();
    };
    const rememberFocus = () => { focusedInside = popup.contains(document.activeElement); };
    root.addEventListener('keydown', keydown);
    root.addEventListener('focusin', rememberFocus);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener('keydown', keydown);
      root.removeEventListener('focusin', rememberFocus);
      if (!dismissedWithTab && (popup.contains(document.activeElement) || (focusedInside && document.activeElement === document.body)) && opener?.isConnected && visible(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, ref, context]);
}

/** Apply the tree keyboard pattern only to file navigation buttons, never to file editors. */
export function useFileTreeKeyboard(ref: RefObject<HTMLElement | null>, open: boolean, expanded: Set<string>, entries: unknown) {
  useEffect(() => {
    const tree = ref.current?.querySelector<HTMLElement>('[role="tree"]');
    if (!open || !tree) return;
    const items = () => Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter(visible);
    const updateTabStop = () => {
      const options = items();
      const active = options.includes(document.activeElement as HTMLElement) ? document.activeElement : options.find(item => item.getAttribute('aria-current') === 'true') || options[0];
      options.forEach(item => { item.tabIndex = item === active ? 0 : -1; });
    };
    updateTabStop();
    const keydown = (event: KeyboardEvent) => {
      const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
      if (!current || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      const options = items();
      const index = options.indexOf(current);
      const level = Number(current.getAttribute('aria-level'));
      event.preventDefault();
      if (event.key === 'ArrowRight' && current.getAttribute('aria-expanded') === 'false' || event.key === 'ArrowLeft' && current.getAttribute('aria-expanded') === 'true') { current.click(); return; }
      const target = event.key === 'Home' ? options[0] : event.key === 'End' ? options.at(-1)
        : event.key === 'ArrowLeft' ? options.slice(0, index).reverse().find(item => Number(item.getAttribute('aria-level')) < level)
        : event.key === 'ArrowRight' ? (Number(options[index + 1]?.getAttribute('aria-level')) > level ? options[index + 1] : undefined)
        : options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      target?.focus();
    };
    tree.addEventListener('keydown', keydown);
    tree.addEventListener('focusin', updateTabStop);
    return () => { tree.removeEventListener('keydown', keydown); tree.removeEventListener('focusin', updateTabStop); };
  }, [ref, open, expanded, entries]);
}
