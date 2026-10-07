const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 105 12l4 4M11 4a7 7 0 010 14',
  send: 'M4 12l16-8-6 16-3-7-7-1z',
  smile: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8.5 14a4.5 4.5 0 007 0M9 9.5h.01M15 9.5h.01',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
  reply: 'M10 8L4 13l6 5v-3.5c5 0 8 1 10 4-.5-5-3.5-8.5-10-9z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4',
  bellOff: 'M6 16V11a6 6 0 011.5-4M18 11v5l2 2H8M10 21h4M4 4l16 16',
  users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M16 6a3 3 0 010 5.5M18 20a6 6 0 00-3-5',
  hash: 'M5 9h15M4 15h15M10 4L8 20M16 4l-2 16',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  refresh: 'M20 5v5h-5M4 19v-5h5M5.5 9A7 7 0 0118 7l2 3M18.5 15A7 7 0 016 17l-2-3',
  chat: 'M4 5h16v11H9l-5 4z',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  down: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12l5 5 9-10',
};

export default function Icon({ name, size = 20, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
