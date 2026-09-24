/** Google Material Icons (Apache 2.0): https://github.com/google/material-design-icons */
const iconPaths = {
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  description: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1 .9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  playArrow: 'M8 5v14l11-7z',
  refresh: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.93 9h-2.02A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  delete: 'M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1 .9 2 2 2h8c1.1 0 2-.9 2-2V7z',
  listAlt: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1 .9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 7h2v2H7zm4 0h6v2h-6zM7 11h2v2H7zm4 0h6v2h-6zM7 15h2v2H7zm4 0h6v2h-6z',
  lightbulb: 'M9 21h6v-1H9v1zm3-19C7.58 2 4 5.58 4 10c0 3.09 1.67 5.77 4.14 7.17L9 18h6l.86-.83C18.33 15.77 20 13.09 20 10c0-4.42-3.58-8-8-8zm2.69 13.5-.69.5h-4l-.69-.5C7.27 14.24 6 12.22 6 10c0-3.31 2.69-6 6-6s6 2.69 6 6c0 2.22-1.27 4.24-3.31 5.5z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  arrowUp: 'm7.41 15.41 4.59-4.58 4.59 4.58L18 14l-6-6-6 6z',
  arrowDown: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
} as const;

export type MaterialIconName = keyof typeof iconPaths;

export function MaterialIcon({
  name,
  size = 18,
  className,
}: {
  name: MaterialIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
