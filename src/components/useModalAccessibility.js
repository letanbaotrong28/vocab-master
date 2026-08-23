import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

let bodyLockCount = 0;
let savedBodyStyles = null;

const getFocusableElements = (container) => (
  Array.from(container?.querySelectorAll(FOCUSABLE_SELECTOR) || [])
    .filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
);

/**
 * Shared modal behavior: lock background scrolling, trap keyboard focus,
 * support Escape, and return focus to the control that opened the modal.
 */
export const useModalAccessibility = ({ isOpen, onClose, canClose = true, initialFocusRef }) => {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  const initialFocusRefRef = useRef(initialFocusRef);

  useEffect(() => {
    onCloseRef.current = onClose;
    canCloseRef.current = canClose;
    initialFocusRefRef.current = initialFocusRef;
  }, [canClose, initialFocusRef, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (bodyLockCount === 0) {
      const computedPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      savedBodyStyles = {
        overflow: document.body.style.overflow,
        paddingRight: document.body.style.paddingRight
      };
      document.body.style.overflow = 'hidden';
      if (scrollbarGap > 0) {
        document.body.style.paddingRight = `${computedPaddingRight + scrollbarGap}px`;
      }
    }
    bodyLockCount += 1;

    const focusDialog = () => {
      const requestedTarget = initialFocusRefRef.current?.current;
      const fallbackTarget = getFocusableElements(dialog)[0] || dialog;
      const target = requestedTarget && !requestedTarget.disabled ? requestedTarget : fallbackTarget;
      target.focus({ preventScroll: true });
    };

    const animationFrame = window.requestAnimationFrame(focusDialog);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (canCloseRef.current) {
          onCloseRef.current?.();
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', handleKeyDown, true);

      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0 && savedBodyStyles) {
        document.body.style.overflow = savedBodyStyles.overflow;
        document.body.style.paddingRight = savedBodyStyles.paddingRight;
        savedBodyStyles = null;
      }

      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => {
          const activeModal = document.querySelector('[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"]');
          if (!activeModal || activeModal.contains(previouslyFocused)) {
            previouslyFocused.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [isOpen]);

  return dialogRef;
};
