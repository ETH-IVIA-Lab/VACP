import type { PresencePoint } from '@vacp/presence-core';

export type CursorAppearance = {
  cursor?: { size?: number; fill?: string; stroke?: string; path?: string; strokeWidth?: number };
  press?: false | { scale?: number; durationMs?: number };
  ripple?: false | { color?: string; size?: number; durationMs?: number };
};

// Geometry adapted from agent-browser's recording cursor. See NOTICE and licenses/agent-browser.txt.
const cursorPath = 'M0 0L14 8.5L7.5 10L4 16Z';
const ns = 'http://www.w3.org/2000/svg';

export function cursorStyle(options: CursorAppearance) {
  const style = {
    size: options.cursor?.size ?? 28,
    strokeWidth: options.cursor?.strokeWidth ?? 1.5,
    pressScale: options.press === false ? 1 : (options.press?.scale ?? 0.8),
    pressMs: options.press === false ? 0 : (options.press?.durationMs ?? 260),
    rippleSize: options.ripple === false ? 0 : (options.ripple?.size ?? 64),
    rippleMs: options.ripple === false ? 0 : (options.ripple?.durationMs ?? 400),
    color: options.ripple === false ? '#60a5fa' : (options.ripple?.color ?? '#60a5fa'),
  };
  for (const [name, value] of Object.entries(style)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid cursor ${name}`);
  }
  if (style.size === 0 || style.pressScale > 1)
    throw new Error('Cursor size must be positive and press scale at most 1');
  return style;
}

/** An activation acknowledgement, separate from pointer motion and application input. */
export function createCursorGraphic(
  svg: SVGSVGElement,
  options: CursorAppearance,
  style: ReturnType<typeof cursorStyle>,
) {
  const doc = svg.ownerDocument;
  const group = doc.createElementNS(ns, 'g');
  const glyph = doc.createElementNS(ns, 'g');
  glyph.dataset.vacpCursor = '';
  glyph.style.transformOrigin = '0 0';
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('d', options.cursor?.path ?? cursorPath);
  path.setAttribute('fill', options.cursor?.fill ?? 'white');
  path.setAttribute('stroke', options.cursor?.stroke ?? 'black');
  path.setAttribute('stroke-width', String(style.strokeWidth));
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('transform', `scale(${style.size / 24})`);
  glyph.append(path);
  group.append(glyph);
  let press: Animation | undefined;
  let ripple: SVGCircleElement | undefined;
  let expansion: Animation | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    press?.cancel();
    press = undefined;
    expansion?.cancel();
    expansion = undefined;
    clearTimeout(timer);
    timer = undefined;
    ripple?.remove();
    ripple = undefined;
  };
  return {
    group,
    activate(point: PresencePoint, reduced: boolean) {
      cancel();
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
      svg.insertBefore(circle, group);
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
