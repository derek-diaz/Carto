import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { children: ReactNode };

const Icon = ({ children, ...props }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {children}
  </svg>
);

export const IconMonitor = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M3 12h4l2.5-5 4.5 10 3-6h4" />
  </Icon>
);

export const IconPublish = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M5 12l14-7-6 14-2-5-6-2z" />
  </Icon>
);

export const IconConnection = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M9 7H7a4 4 0 0 0 0 8h2" />
    <path d="M15 7h2a4 4 0 1 1 0 8h-2" />
    <path d="M8 12h8" />
  </Icon>
);

export const IconLogs = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
    <circle cx="6" cy="6" r="1" />
    <circle cx="6" cy="12" r="1" />
    <circle cx="6" cy="18" r="1" />
  </Icon>
);

export const IconSettings = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="8" cy="6" r="2" />
    <circle cx="16" cy="12" r="2" />
    <circle cx="10" cy="18" r="2" />
  </Icon>
);

export const IconSun = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M3 12h2M19 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
  </Icon>
);

export const IconMoon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5z" />
  </Icon>
);

export const IconCopy = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <rect x="4" y="4" width="11" height="11" rx="2" />
  </Icon>
);

export const IconSave = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M5 3h11l3 3v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M9 3v6h6" />
    <path d="M7 14h10v6H7z" />
  </Icon>
);

export const IconPause = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Icon>
);

export const IconPlay = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <polygon points="8 5 19 12 8 19 8 5" />
  </Icon>
);

export const IconTrash = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M6 6l1 14h10l1-14" />
  </Icon>
);

export const IconHash = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="3" y1="15" x2="19" y2="15" />
  </Icon>
);

export const IconClock = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </Icon>
);

export const IconReplay = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.5 15a8 8 0 1 1 2.5-5" />
  </Icon>
);

export const IconLinkOff = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M9 7H7a4 4 0 0 0 0 8h2" />
    <path d="M15 7h2a4 4 0 0 1 2.8 6.9" />
    <path d="M8 12h3" />
    <path d="M3 3l18 18" />
  </Icon>
);

export const IconPlus = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconStop = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Icon>
);

export const IconPlug = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M9 2v4M15 2v4" />
    <path d="M7 6h10v4a5 5 0 0 1-10 0V6z" />
    <path d="M12 14v6" />
  </Icon>
);

export const IconClose = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6l-12 12" />
  </Icon>
);

export const IconFollow = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" />
  </Icon>
);

export const IconLatest = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 5v10" />
    <path d="M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </Icon>
);

export const IconHighlighter = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M3 21h6" />
    <path d="M14 6l4 4" />
    <path d="M7 17l7-7" />
    <path d="M5 19l2-2" />
  </Icon>
);

export const IconSearch = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);

export const IconChevronDown = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
