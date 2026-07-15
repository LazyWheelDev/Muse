import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const common = {
  width: 28,
  height: 28,
  viewBox: '0 0 28 28',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function HangerIcon(props: IconProps) {
  return (
    <svg {...common} {...props}>
      <path d="M12 7.2a2.4 2.4 0 1 1 3.1 2.3c-.8.3-1.1.9-1.1 1.6v.5" />
      <path d="m3.2 21 9.6-7.5a2 2 0 0 1 2.4 0l9.6 7.5c.8.6.4 1.8-.6 1.8H3.8c-1 0-1.4-1.2-.6-1.8Z" />
    </svg>
  );
}

export function HatIcon(props: IconProps) {
  return (
    <svg {...common} {...props}>
      <path d="M8 17.5 9.7 9a2.5 2.5 0 0 1 2.5-2h3.6a2.5 2.5 0 0 1 2.5 2l1.7 8.5" />
      <path d="M4 18c3.2 2.8 16.8 2.8 20 0-3.2-1.2-16.8-1.2-20 0Z" />
    </svg>
  );
}

export function ScarfIcon(props: IconProps) {
  return (
    <svg {...common} {...props}>
      <path d="M9 5c1.6 2.1 8.4 2.1 10 0l1 4.4c-2.3 2.7-9.7 2.7-12 0L9 5Z" />
      <path d="m10 11-1.7 12M18 11l1.7 12M7 20l3 .5M18 20.5l3-.5" />
    </svg>
  );
}

export function DressIcon(props: IconProps) {
  return (
    <svg {...common} {...props}>
      <path d="M11 4h6l1 5-2.2 3.2L22 24H6l6.2-11.8L10 9l1-5Z" />
      <path d="M12.2 12.2h3.6" />
    </svg>
  );
}

export function PantsIcon(props: IconProps) {
  return (
    <svg {...common} {...props}>
      <path d="M8 4h12l-1 20h-4l-1-11-1 11H9L8 4Z" />
      <path d="M8.5 8h11" />
    </svg>
  );
}

export function ShoeIcon(props: IconProps) {
  return (
    <svg {...common} {...props}>
      <path d="M5 17c3.8 0 6.2-2.3 7.2-6.5l4.5 4.2c1.9 1.8 3.7 2.6 6.3 2.8v4.2H5V17Z" />
      <path d="M12 15h3M15 17h3" />
    </svg>
  );
}

export function AccessoryIcon(props: IconProps) {
  return (
    <svg {...common} {...props}>
      <circle cx="14" cy="14" r="8" />
      <circle cx="14" cy="14" r="3" />
      <path d="M14 3v3M14 22v3M3 14h3M22 14h3" />
    </svg>
  );
}
