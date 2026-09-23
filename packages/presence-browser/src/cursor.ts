import type { PresenceActivity, PresencePoint } from '@vacp/presence-core';
import { defaultCursorAssets, type CursorAsset, type CursorShape } from './cursor-assets';
import { defaultCursorPresentation, type CursorPresentation } from './cursor-semantics';
import { updateAttribute } from './svg';

export type CursorAppearance = {
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

const ns = 'http://www.w3.org/2000/svg';

export function cursorStyle(options: CursorAppearance) {
  const style = {
    size: options.cursor?.size ?? 28,
    strokeWidth: options.cursor?.strokeWidth ?? 1.5,
    pressScale: options.press === false ? 1 : (options.press?.scale ?? 0.8),
    pressMs: options.press === false ? 0 : (options.press?.durationMs ?? 260),
    rippleSize: options.ripple === false ? 0 : (options.ripple?.size ?? 64),
    rippleMs: options.ripple === false ? 0 : (options.ripple?.durationMs ?? 400),
    bloomRadius: options.bloom === false ? 0 : (options.bloom?.radius ?? 22),
    color: options.ripple === false ? '#60a5fa' : (options.ripple?.color ?? '#60a5fa'),
  };
  for (const [name, value] of Object.entries(style)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid cursor ${name}`);
  }
  if (style.size === 0 || style.pressScale > 1)
    throw new Error('Cursor size must be positive and press scale at most 1');
  const assets = new Map<string, CursorAsset>(Object.entries({ ...defaultCursorAssets, ...options.cursor?.assets }));
  for (const asset of assets.values()) {
    if (!asset.path || !Number.isFinite(asset.hotspot.x) || !Number.isFinite(asset.hotspot.y))
      throw new Error('Cursor assets require a path and a finite hotspot');
  }
  return { ...style, assets };
}

/** An activation acknowledgement, separate from pointer motion and application input. */
export function createCursorGraphic(
  svg: SVGSVGElement,
  options: CursorAppearance,
  style: ReturnType<typeof cursorStyle>,
) {
  const doc = svg.ownerDocument;
  const group = doc.createElementNS(ns, 'g');
  const halo = doc.createElementNS(ns, 'circle');
  halo.dataset.vacpBloom = '';
  halo.setAttribute('r', String(style.bloomRadius));
  halo.setAttribute('cx', String(style.size / 3));
  halo.setAttribute('cy', String(style.size / 3));
  halo.setAttribute('fill', options.bloom === false ? 'none' : (options.bloom?.color ?? '#78b7ff'));
  halo.style.filter = 'blur(9px)';
  group.append(halo);
  const travel = doc.createElementNS(ns, 'g');
  travel.dataset.vacpTravel = '';
  const glyph = doc.createElementNS(ns, 'g');
  glyph.dataset.vacpCursor = '';
  glyph.style.transformOrigin = '0 0';
  if (options.bloom !== false) glyph.style.filter = 'drop-shadow(0 2px 2px rgba(20,35,60,.3))';
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('stroke', options.cursor?.stroke ?? 'black');
  path.setAttribute('stroke-width', String(style.strokeWidth));
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  glyph.append(path);
  travel.append(glyph);
  group.append(travel);
  let resting: CursorShape = 'arrow',
    active: CursorShape = 'arrow',
    pressed = false;
  let running = false;
  let acknowledge = true;
  const paint = () => {
    const shape = pressed || running ? active : resting;
    const asset = style.assets.get(shape) ?? style.assets.get('arrow')!;
    updateAttribute(glyph, 'data-vacp-cursor-shape', style.assets.has(shape) ? shape : 'arrow');
    updateAttribute(path, 'd', asset.path);
    updateAttribute(path, 'fill', options.cursor?.fill ?? asset.fill ?? 'white');
    updateAttribute(path, 'transform', `scale(${style.size / 24}) translate(${-asset.hotspot.x} ${-asset.hotspot.y})`);
  };
  paint();
  let press: Animation | undefined;
  let ripple: SVGCircleElement | undefined;
  let expansion: Animation | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    press?.cancel();
    press = undefined;
    clearTimeout(release);
    release = undefined;
    pressed = false;
    paint();
    expansion?.cancel();
    expansion = undefined;
    clearTimeout(timer);
    timer = undefined;
    ripple?.remove();
    ripple = undefined;
  };
  return {
    group,
    setActivity(activity: PresenceActivity) {
      running = activity.execution?.phase === 'running' && activity.phase === 'acting';
      updateAttribute(halo, 'opacity', activity.phase === 'thinking' ? '0.35' : '0.18');
      const presentation = (options.cursor?.resolve ?? defaultCursorPresentation)(activity);
      resting = presentation.shape;
      active = presentation.activeShape ?? resting;
      acknowledge = presentation.feedback ?? true;
      paint();
    },
    setTravelScale(scale: number) {
      updateAttribute(travel, 'transform', `scale(${scale})`);
    },
    activate(point: PresencePoint, reduced: boolean) {
      cancel();
      if (!acknowledge) return;
      if (style.pressMs) {
        pressed = true;
        paint();
        release = setTimeout(
          () => {
            pressed = false;
            paint();
          },
          reduced ? Math.min(180, style.pressMs) : style.pressMs,
        );
      }
      if (style.pressMs && !reduced) {
        press = glyph.animate(
          [
            { transform: 'scale(1)' },
            { transform: `scale(${style.pressScale})`, offset: 0.3 },
            { transform: `scale(${style.pressScale})`, offset: 0.55 },
            { transform: 'scale(1)' },
          ],
          { duration: style.pressMs, easing: 'ease-in-out' },
        );
      }
      if (!style.rippleSize || !style.rippleMs) return;
      const circle = doc.createElementNS(ns, 'circle');
      circle.dataset.vacpRipple = '';
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', String(reduced ? Math.min(8, style.rippleSize / 2) : style.rippleSize / 2));
      circle.setAttribute('fill', style.color);
      circle.setAttribute('fill-opacity', '0.5');
      circle.setAttribute('stroke', style.color);
      circle.setAttribute('stroke-width', '2');
      circle.style.transformOrigin = `${point.x}px ${point.y}px`;
      svg.append(circle);
      ripple = circle;
      const remove = () => {
        circle.remove();
        if (ripple === circle) ripple = undefined;
      };
      if (reduced) timer = setTimeout(remove, Math.min(180, style.rippleMs));
      else {
        expansion = circle.animate(
          [
            { transform: 'scale(0)', opacity: 0.8 },
            { transform: 'scale(1)', opacity: 0 },
          ],
          { duration: style.rippleMs, easing: 'linear', fill: 'forwards' },
        );
        void expansion.finished.then(remove, remove);
      }
    },
    cancel,
    remove() {
      cancel();
      group.remove();
    },
  };
}
