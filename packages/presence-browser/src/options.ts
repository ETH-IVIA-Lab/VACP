import type { PresenceActivity, PresencePoint } from '@ethivia/vacp-presence';
import { defaultCursorAssets, type CursorAsset } from './cursor-assets';
import { defaultCursorPresentation, type CursorPresentation } from './cursor-semantics';
import { describePresence } from './describe';
import { travelStyle, type CursorTravel } from './motion';
import type { PresenceText } from './text';

/** Lucide `bot`, with its body rectangle expressed as a path so one stroked path draws the mark. See NOTICE. */
const agentIcon =
  'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2';

export type BrowserPresenceOptions = {
  document?: Document;
  motion?: 'system' | 'reduced' | 'full';
  /** Approximate settling time. Retargeting preserves velocity. */
  durationMs?: number;
  travel?: CursorTravel;
  cue?: { color?: string; visible?: boolean };
  /** Optional public progress bubble. `icon` is stroked path data in a 24-unit square, shown for agents. */
  bubble?: false | { width?: number; icon?: string | false };
  /** Optional incremental message presentation. The default renders plain text. */
  text?: PresenceText;
  /** Quiet motion while the host reports thinking, in CSS pixels. */
  hover?: false | { distance?: number; periodMs?: number };
  /** Initial position for an actor without a known target. */
  idlePosition?: (viewport: { width: number; height: number }) => PresencePoint;
  describe?: (activity: PresenceActivity) => string;
  bloom?: false | { color?: string; radius?: number };
  cursor?: {
    size?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    assets?: Readonly<Record<string, CursorAsset>>;
    resolve?: (activity: PresenceActivity) => CursorPresentation;
  };
  press?: false | { scale?: number; durationMs?: number };
  ripple?: false | { color?: string; size?: number; durationMs?: number };
};

export type PresenceConfig = ReturnType<typeof resolvePresenceOptions>;

/** Validate every option before the overlay touches the document. */
export function resolvePresenceOptions(options: BrowserPresenceOptions) {
  const numbers = {
    duration: options.durationMs ?? 320,
    hoverDistance: options.hover === false ? 0 : (options.hover?.distance ?? 2.5),
    hoverPeriod: (options.hover || undefined)?.periodMs ?? 2600,
    bubbleWidth: (options.bubble || undefined)?.width ?? 260,
  };
  if (
    !Object.values(numbers).every(Number.isFinite) ||
    numbers.duration < 0 ||
    numbers.hoverDistance < 0 ||
    numbers.hoverPeriod <= 0 ||
    numbers.bubbleWidth < 120
  )
    throw new Error('Invalid presence motion or bubble dimensions');
  const icon = options.bubble === false ? false : (options.bubble?.icon ?? agentIcon);
  if (icon !== false && !icon.trim()) throw new Error('A bubble icon requires path data');
  const cursor = {
    size: options.cursor?.size ?? 28,
    strokeWidth: options.cursor?.strokeWidth ?? 1.5,
    pressScale: options.press === false ? 1 : (options.press?.scale ?? 0.8),
    pressMs: options.press === false ? 0 : (options.press?.durationMs ?? 260),
    rippleSize: options.ripple === false ? 0 : (options.ripple?.size ?? 64),
    rippleMs: options.ripple === false ? 0 : (options.ripple?.durationMs ?? 400),
    bloomRadius: options.bloom === false ? 0 : (options.bloom?.radius ?? 22),
  };
  for (const [name, value] of Object.entries(cursor)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid cursor ${name}`);
  }
  if (cursor.size === 0 || cursor.pressScale > 1)
    throw new Error('Cursor size must be positive and press scale at most 1');
  const assets = new Map<string, CursorAsset>(Object.entries({ ...defaultCursorAssets, ...options.cursor?.assets }));
  for (const asset of assets.values()) {
    if (!asset.path || !Number.isFinite(asset.hotspot.x) || !Number.isFinite(asset.hotspot.y))
      throw new Error('Cursor assets require a path and a finite hotspot');
  }
  return {
    ...numbers,
    travel: travelStyle(options.travel),
    motion: options.motion ?? 'system',
    surface: 'viewport',
    describe: options.describe ?? describePresence,
    idlePosition: options.idlePosition,
    zIndex: 2147483646,
    text: options.text,
    bubble: options.bubble !== false,
    icon,
    cue: { color: options.cue?.color ?? '#62666c', visible: options.cue?.visible !== false },
    cursor: {
      ...cursor,
      assets,
      fill: options.cursor?.fill,
      stroke: options.cursor?.stroke ?? 'black',
      resolve: options.cursor?.resolve ?? defaultCursorPresentation,
      bloom: options.bloom === false ? undefined : (options.bloom?.color ?? '#78b7ff'),
      ripple: (options.ripple || undefined)?.color ?? '#60a5fa',
    },
  };
}
