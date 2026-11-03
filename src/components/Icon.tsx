/** Inline SVG icons (no external assets — keeps the strict CSP simple). */
const PATHS: Record<string, string> = {
  building: 'M3 14V3.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 .5.5V14M10 6.5h2.5a.5.5 0 0 1 .5.5V14M2 14h12M5.5 5.5h2M5.5 8h2M5.5 10.5h2',
  pin: 'M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14zM8 8.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z',
  minimize: 'M3.5 8h9',
  expand: 'M4 6l4 4 4-4',
  close: 'M4 4l8 8M12 4l-8 8',
  alert: 'M8 2.5l6 10.5H2L8 2.5zM8 6.5v3M8 11.2v.1',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v4M8 5v.1',
  check: 'M3.5 8.5l3 3 6-7',
  stop: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM5.5 5.5l5 5M10.5 5.5l-5 5',
  download: 'M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10',
  folder: 'M2 4.5a1 1 0 0 1 1-1h3.2l1.3 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5z',
  external: 'M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V5a.5.5 0 0 1 .5-.5H7',
  edit: 'M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z',
  refresh: 'M13 3v3.5H9.5M3 13V9.5h3.5M12.6 6.3A5 5 0 0 0 3.6 5M3.4 9.7a5 5 0 0 0 9 1.3',
  target: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 8.1v-.2',
  upload: 'M8 11V2.5M4.5 6L8 2.5 11.5 6M3 13.5h10',
  doc: 'M4 1.5h5l3.5 3.5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5zM9 1.5V5h3.5M5.5 8h5M5.5 10.5h5',
  key: 'M10 2.5a3.5 3.5 0 1 1-2.9 5.4L2.5 12.5v1.5H4l.5-.5V12H6v-1.5h1.5l.6-.6A3.5 3.5 0 0 1 10 2.5zM11 5v.1',
  shield: 'M8 1.5l5 2v4c0 3.2-2.2 5.6-5 7-2.8-1.4-5-3.8-5-7v-4l5-2z',
  history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5',
  gear: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM13 8l1.3-.9-1-2.2-1.6.2-1-1 .2-1.6-2.2-1L7.8 2.7H6.2L5.3 1.5l-2.2 1 .2 1.6-1 1-1.6-.2-1 2.2L1 8l-1.3.9 1 2.2 1.6-.2 1 1-.2 1.6 2.2 1 .9-1.3h1.6l.9 1.3 2.2-1-.2-1.6 1-1 1.6.2 1-2.2L13 8z',
  user: 'M8 7.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14.5c.6-2.8 2.8-4.5 5.5-4.5s4.9 1.7 5.5 4.5',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  plus: 'M8 3v10M3 8h10',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9',
  copy: 'M5.5 5.5V3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-2.5M3 5.5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5z',
  bell: 'M4 11V7a4 4 0 1 1 8 0v4l1 1.5H3L4 11zM6.5 14h3',
  note: 'M3 2.5h10v8l-3 3H3v-11zM10 13.5v-3h3M5.5 6h5M5.5 8.5h3',
  sort: 'M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5',
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.6 10.6L14 14',
  phone: 'M5.2 2.5L3 3c-.5 4.6 4.4 9.5 9 10l.5-2.2-2.6-1.3-1.2 1.2C7.3 10 6 8.7 5.3 7.3l1.2-1.2-1.3-3.6z',
  mail: 'M2 4h12v8.5H2V4zM2.3 4.3L8 8.8l5.7-4.5',
  back: 'M10 3L5 8l5 5',
  forward: 'M6 3l5 5-5 5',
  globe: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM1.5 8h13M8 1.5c1.8 1.8 2.7 4 2.7 6.5S9.8 12.7 8 14.5C6.2 12.7 5.3 10.5 5.3 8S6.2 3.3 8 1.5z',
  home: 'M2.5 7.5L8 2.5l5.5 5M4 6.5V13.5h8V6.5',
  palette: 'M8 1.5a6.5 6.5 0 0 0 0 13c1 0 1.5-.6 1.5-1.3 0-.9-.8-1.2-.8-2 0-.7.6-1.2 1.3-1.2h1.5a3 3 0 0 0 3-3C14.5 4 11.6 1.5 8 1.5zM4.8 8.2v.1M6 5v.1M9.5 4.5v.1M11.8 6.8v.1',
  briefcase: 'M2 5h12v8H2V5zM5.5 5V3.5h5V5M2 8.5h12',
  database: 'M3 3.5c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={className}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}

/** App mark / tray-sized icon (teal rounded square with the ApplyFlow “A”). */
export function AppMark({ size = 18 }: { size?: number }) {
  return (
    <img
      className="app-mark"
      src={`${import.meta.env.BASE_URL}brand/app-icon.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

/** Full wordmark for the application header / navigation rail. */
export function BrandLogo({ height = 44, title = 'ApplyFlow' }: { height?: number; title?: string }) {
  return (
    <img
      className="brand-logo"
      src={`${import.meta.env.BASE_URL}brand/logo-header.png`}
      alt={title}
      height={height}
      style={{ height, width: 'auto' }}
      draggable={false}
    />
  );
}
