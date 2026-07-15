import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import styles from './Buttons.module.css';

type ButtonVariant = 'secondary' | 'primary' | 'danger' | 'quiet';

function classes(variant: ButtonVariant, fullWidth: boolean, iconOnly: boolean): string {
  return [
    styles.button,
    styles[variant],
    fullWidth ? styles.fullWidth : '',
    iconOnly ? styles.iconOnly : '',
  ]
    .filter(Boolean)
    .join(' ');
}

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  iconOnly?: boolean;
}

export function ActionButton({
  variant = 'secondary',
  fullWidth = false,
  iconOnly = false,
  className,
  type = 'button',
  ...props
}: ActionButtonProps) {
  return (
    <button
      className={`${classes(variant, fullWidth, iconOnly)} ${className ?? ''}`}
      type={type}
      {...props}
    />
  );
}

interface NavigationButtonProps {
  to: string;
  children: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string | undefined;
  'aria-label'?: string;
}

export function NavigationButton({
  to,
  children,
  variant = 'secondary',
  fullWidth = false,
  className,
  ...props
}: NavigationButtonProps) {
  return (
    <Link
      className={`${styles.linkButton} ${styles[variant]} ${fullWidth ? styles.fullWidth : ''} ${className ?? ''}`}
      to={to}
      {...props}
    >
      {children}
    </Link>
  );
}

interface RoundActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

export function RoundAction({ icon, label, ...props }: RoundActionProps) {
  return (
    <button className={styles.roundAction} type="button" aria-label={label} {...props}>
      <span className={styles.roundActionIcon} aria-hidden="true">
        {icon}
      </span>
      <span aria-hidden="true">{label}</span>
    </button>
  );
}
