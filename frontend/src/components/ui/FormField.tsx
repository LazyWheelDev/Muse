import { useId } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import styles from './FormField.module.css';

interface FieldFrameProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}

function FieldFrame({ id, label, hint, error, children }: FieldFrameProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint === undefined ? null : (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error === undefined ? null : (
        <span className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function TextField({ label, hint, error, id: suppliedId, ...props }: TextFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <input
        className={styles.control}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={
          [hint === undefined ? null : `${id}-hint`, error === undefined ? null : `${id}-error`]
            .filter(Boolean)
            .join(' ') || undefined
        }
        {...props}
      />
    </FieldFrame>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function SelectField({
  label,
  hint,
  error,
  id: suppliedId,
  children,
  ...props
}: SelectFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <select
        className={styles.control}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={
          [hint === undefined ? null : `${id}-hint`, error === undefined ? null : `${id}-error`]
            .filter(Boolean)
            .join(' ') || undefined
        }
        {...props}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function TextAreaField({
  label,
  hint,
  error,
  id: suppliedId,
  ...props
}: TextAreaFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <textarea
        className={styles.control}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={
          [hint === undefined ? null : `${id}-hint`, error === undefined ? null : `${id}-error`]
            .filter(Boolean)
            .join(' ') || undefined
        }
        {...props}
      />
    </FieldFrame>
  );
}
