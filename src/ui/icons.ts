/** Small inline SVG icons for the enterprise shell (presentation only). */
export function icon(name: string, className = "icon"): string {
  const paths: Record<string, string> = {
    dash: '<path d="M4 4h7v7H4V4zm9 0h7v5h-7V4zM4 13h7v7H4v-7zm9 3h7v4h-7v-4z"/>',
    roster: '<path d="M7 4h10a2 2 0 0 1 2 2v14l-7-3-7 3V6a2 2 0 0 1 2-2z"/>',
    live: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M5 19l1.5-1.5"/>',
    settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.5 3.1-.9-.5.2-1 1.1-.6-.7-1.3-1.2.2-.7-.8.1-1.2-1.4-.3-.4-1.1-1.1-.1-.7.8-1 0-1-.8-.4 1.1-1.4.3.1 1.2-.7.8-1.2-.2-.7 1.3 1.1.6.2 1-.9.5v1.2l.9.5-.2 1-1.1.6.7 1.3 1.2-.2.7.8-.1 1.2 1.4.3.4 1.1 1.1.1.7-.8 1 0 1 .8.4-1.1 1.4-.3-.1-1.2.7-.8 1.2.2.7-1.3-1.1-.6-.2-1 .9-.5v-1.2z"/>',
    hist: '<path d="M12 5a7 7 0 1 1-6.3 4H8l-3 3-3-3h2.1A9 9 0 1 0 12 3v2zm1 3v4l3 2"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>',
    bell: '<path d="M6 17h12l-1.2-1.2A2 2 0 0 1 16 14.4V11a4 4 0 1 0-8 0v3.4a2 2 0 0 1-.8 1.4L6 17zm4 2a2 2 0 0 0 4 0"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    save: '<path d="M5 5h11l3 3v11H5V5zm3 0v5h7V5"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 19a7 7 0 0 1 14 0"/>',
    logout: '<path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M14 12H8m8-4 4 4-4 4"/>',
    warn: '<path d="M12 3 2 20h20L12 3zm0 7v4m0 3.5v.5"/>',
  };
  const body = paths[name] || paths.dash;
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
