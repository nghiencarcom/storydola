import type { ReactNode } from "react";

export type IconName =
  | "grid" | "folder" | "layers" | "bolt" | "settings" | "help" | "play"
  | "check" | "clock" | "scene" | "stack" | "alert" | "more" | "arrow"
  | "external" | "download" | "link" | "spark" | "search" | "chevron"
  | "plus" | "sliders" | "save" | "file" | "users" | "refresh" | "copy" | "logout" | "trash" | "upload" | "image";

const icons: Record<IconName, ReactNode> = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  folder: <><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2.1 2.1h6.9a2 2 0 0 1 2 2v8.1a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.7 10h16.6" /></>,
  layers: <><path d="m12 3.5 8.5 4.7-8.5 4.7-8.5-4.7z" /><path d="m4 12 8 4.5 8-4.5" /><path d="m4 16 8 4.5 8-4.5" /></>,
  bolt: <path d="m13.3 2.8-8.1 10h6.1l-.6 8.4 8.1-10.5h-6.1z" />,
  settings: <><path d="M10.1 3.5h3.8l.5 2.1a7 7 0 0 1 1.6.9l2-.8 1.9 3.3-1.5 1.5a7 7 0 0 1 0 1.9l1.5 1.5-1.9 3.3-2-.8a7 7 0 0 1-1.6.9l-.5 2.1h-3.8l-.5-2.1a7 7 0 0 1-1.6-.9l-2 .8-1.9-3.3 1.5-1.5a7 7 0 0 1 0-1.9L4.1 9l1.9-3.3 2 .8a7 7 0 0 1 1.6-.9z" /><circle cx="12" cy="11.5" r="2.7" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 1 1 4.5 1.2c-.7 1-2.2 1.4-2.2 3" /><path d="M12 16.7h.01" /></>,
  play: <path d="m9 6.5 9.5 5.5L9 17.5z" fill="currentColor" stroke="none" />,
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  clock: <><circle cx="12" cy="12" r="8.7" /><path d="M12 7v5.2l3.4 2" /></>,
  scene: <><path d="M4 7.5h16v12H4z" /><path d="m4 7.5 2.3-4h16l-2.3 4" /><path d="m9 3.5-2.3 4M15 3.5l-2.3 4M21 3.5l-2.3 4" /><path d="M9 11v5l4-2.5z" fill="currentColor" stroke="none" /></>,
  stack: <><rect x="5" y="4" width="14" height="15" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /><path d="M3 7v13a1 1 0 0 0 1 1h12" /></>,
  alert: <><path d="m12 3.5 9 16H3z" /><path d="M12 9v4.5M12 17h.01" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  arrow: <><path d="M4.5 12h14" /><path d="m13 6.5 5.5 5.5-5.5 5.5" /></>,
  external: <><path d="M13 5h6v6" /><path d="m19 5-8 8" /><path d="M17 13.5v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 17.5v-9A1.5 1.5 0 0 1 6.5 7h4" /></>,
  download: <><path d="M12 3.5v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4.5 17v3h15v-3" /></>,
  link: <><path d="M9.8 14.2 8 16a3.5 3.5 0 0 1-5-5l3.4-3.4a3.5 3.5 0 0 1 5 0" /><path d="m14.2 9.8 1.8-1.8a3.5 3.5 0 0 1 5 5l-3.4 3.4a3.5 3.5 0 0 1-5 0" /><path d="m8.5 15.5 7-7" /></>,
  spark: <><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  sliders: <><path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h8M16 18h4" /><circle cx="13" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></>,
  save: <><path d="M5 3.5h12l3.5 3.5v13.5H4a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" /><path d="M7 3.5v6h10v-6M8 20v-7h8v7" /></>,
  file: <><path d="M6 3.5h8l4 4v13H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" /><path d="M14 3.5v4h4M8 12h8M8 16h8" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1M17 14a5.2 5.2 0 0 1 3.5 5" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M4.5 10a7.7 7.7 0 0 1 13.1-4L20 8" /><path d="M4 17v-5h5" /><path d="M19.5 14a7.7 7.7 0 0 1-13.1 4L4 16" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  logout: <><path d="M10 5H5.5A1.5 1.5 0 0 0 4 6.5v11A1.5 1.5 0 0 0 5.5 19H10" /><path d="M14 8l4 4-4 4M18 12H9" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="m6 7 .8 13h10.4L18 7M9 7V4h6v3" /></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 5-5 3 3 3-4 5 6" /></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg className="icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{icons[name]}</svg>;
}
