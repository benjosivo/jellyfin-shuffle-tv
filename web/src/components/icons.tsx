import type { ReactNode } from "react";

// Icônes SVG en ligne (pas de dépendance).

type Props = { size?: number };
const svg = (size: number, children: ReactNode, filled = false) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={filled ? "currentColor" : "none"}
    stroke={filled ? "none" : "currentColor"}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const PlayIcon = ({ size = 28 }: Props) => svg(size, <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />, true);
export const PauseIcon = ({ size = 28 }: Props) =>
  svg(size, <><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></>, true);
export const NextIcon = ({ size = 24 }: Props) =>
  svg(size, <><path d="M5 5.5v13a1 1 0 0 0 1.5.86L16 13.5a1.7 1.7 0 0 0 0-3L6.5 4.64A1 1 0 0 0 5 5.5z" /><rect x="17" y="4.5" width="3" height="15" rx="1" /></>, true);
export const StopIcon = ({ size = 22 }: Props) => svg(size, <rect x="5.5" y="5.5" width="13" height="13" rx="2" />, true);
export const UpIcon = ({ size = 20 }: Props) => svg(size, <path d="M12 19V5M5 12l7-7 7 7" />);
export const PlusIcon = ({ size = 20 }: Props) => svg(size, <path d="M12 5v14M5 12h14" />);
export const CloseIcon =({ size = 20 }: Props) => svg(size, <path d="M6 6l12 12M18 6L6 18" />);
export const ShuffleIcon = ({ size = 18 }: Props) =>
  svg(size, <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />);
export const VolumeIcon = ({ size = 22, muted = false }: Props & { muted?: boolean }) =>
  svg(
    size,
    <>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {muted ? <path d="M23 9l-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
    </>,
  );
