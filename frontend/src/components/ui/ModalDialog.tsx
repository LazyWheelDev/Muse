import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import styles from './ModalDialog.module.css';

interface ModalDialogProps {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string | undefined;
}

const focusableSelector =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalDialog({
  title,
  description,
  children,
  onClose,
  className,
}: ModalDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const firstFocus =
      dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    firstFocus?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    function handleDocumentKeyDown(event: KeyboardEvent) {
      handleKeyDown(event);
    }
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  });

  return (
    <div className={styles.backdrop}>
      <div
        className={`${styles.dialog} ${className ?? ''}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
      >
        <h2 id={titleId}>{title}</h2>
        {description === undefined ? null : <p id={descriptionId}>{description}</p>}
        {children}
      </div>
    </div>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export function DialogError({ children }: { children: ReactNode }) {
  return (
    <p className={styles.error} role="alert">
      {children}
    </p>
  );
}
