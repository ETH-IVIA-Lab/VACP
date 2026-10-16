import type { PresencePoint } from '@vacp/presence-core';

/** Inline SVG geometry in a 24-unit square. The hotspot stays on the analytical target. */
export type CursorAsset = {
  path: string;
  hotspot: PresencePoint;
  fill?: string;
};

// Arrow geometry follows agent-browser. Hand silhouettes adapt Tabler Icons; see NOTICE.
export const defaultCursorAssets = {
  arrow: { path: 'M0 0L14 8.5L7.5 10L4 16Z', hotspot: { x: 0, y: 0 } },
  pointer: {
    path: 'M8 13v-8.5a1.5 1.5 0 0 1 3 0v5a1.5 1.5 0 1 1 3 0v1a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-2h.208a6 6 0 0 1-5.012-2.7a69.74 69.74 0 0 1-.196-.3c-.312-.479-1.407-2.388-3.286-5.728a1.5 1.5 0 0 1 .536-2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47ZM11 9.5V12M14 10.5V12M17 11.5V12',
    hotspot: { x: 9.5, y: 3 },
  },
  crosshair: {
    path: 'M11 2h2v7h-2ZM2 11h7v2H2Zm13 0h7v2h-7Zm-4 4h2v7h-2Z',
    hotspot: { x: 12, y: 12 },
  },
  grab: {
    path: 'M8 13v-7.5a1.5 1.5 0 0 1 3 0v-2a1.5 1.5 0 1 1 3 0v2a1.5 1.5 0 0 1 3 0v2a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1-6 6h-2h.208a6 6 0 0 1-5.012-2.7a69.74 69.74 0 0 1-.196-.3c-.312-.479-1.407-2.388-3.286-5.728a1.5 1.5 0 0 1 .536-2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47ZM11 5.5V12M14 5.5V12M17 7.5V12',
    hotspot: { x: 12, y: 12 },
  },
  grabbing: {
    path: 'M8 11v-3.5a1.5 1.5 0 0 1 3 0v-1a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v2a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-2h.208a6 6 0 0 1-5.012-2.7l-.196-.3c-.312-.479-1.407-2.388-3.286-5.728a1.5 1.5 0 0 1 .536-2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47ZM11 7.5V10M14 7.5V10M17 9.5V10',
    hotspot: { x: 12, y: 12 },
  },
  text: { path: 'M8 3h3l1 1 1-1h3v2h-3v14h3v2h-3l-1-1-1 1H8v-2h3V5H8Z', hotspot: { x: 12, y: 12 } },
  'resize-x': { path: 'M2 12l5-5v3h10V7l5 5-5 5v-3H7v3Z', hotspot: { x: 12, y: 12 } },
  'resize-y': { path: 'M12 2l5 5h-3v10h3l-5 5-5-5h3V7H7Z', hotspot: { x: 12, y: 12 } },
  move: { path: 'M12 1l4 4h-3v6h6V8l4 4-4 4v-3h-6v6h3l-4 4-4-4h3v-6H5v3l-4-4 4-4v3h6V5H8Z', hotspot: { x: 12, y: 12 } },
  zoom: { path: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6', hotspot: { x: 10, y: 10 } },
  'zoom-in': { path: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6M6 10h8M10 6v8', hotspot: { x: 10, y: 10 } },
  'zoom-out': { path: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6M6 10h8', hotspot: { x: 10, y: 10 } },
} as const satisfies Record<string, CursorAsset>;

export type CursorShape = keyof typeof defaultCursorAssets | (string & {});
