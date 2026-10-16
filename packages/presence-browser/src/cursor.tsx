import * as stylex from '@stylexjs/stylex';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMotion, usePresence } from './context';
import type { PointerMotion } from './pointer-motion';
import type { Slot } from './slots';

const expand = stylex.keyframes({
  from: { transform: 'scale(0)', opacity: 0.8 },
  to: { transform: 'scale(1)', opacity: 0 },
});

const styles = stylex.create({
  bloom: { filter: 'blur(9px)' },
  glyph: { transformOrigin: '0 0' },
  shadow: { filter: 'drop-shadow(0 2px 2px rgba(20,35,60,.3))' },
  ripple: (x: number, y: number, ms: number) => ({
    transformOrigin: `${x}px ${y}px`,
    animationName: expand,
    animationDuration: `${ms}ms`,
    animationTimingFunction: 'linear',
    animationFillMode: 'forwards',
  }),
});

const useActivation = (pointer: PointerMotion) =>
  useSyncExternalStore(pointer.activation.subscribe, pointer.activation.get);

/** The agent's pointer glyph. Its shape follows the step's interaction; an activation presses it once. */
export function Cursor({ slot, pointer }: { slot: Slot; pointer: PointerMotion }) {
  const { cursor } = usePresence().config;
  const { reduced } = useMotion();
  const activation = useActivation(pointer);
  const glyph = useRef<SVGGElement>(null);
  const [released, setReleased] = useState<number>();
  const acknowledged = !!activation && slot.cursor.feedback;
  const pressed = acknowledged && cursor.pressMs > 0 && released !== activation.id;
  useEffect(() => {
    if (!pressed) return;
    const timer = setTimeout(
      () => setReleased(activation.id),
      reduced ? Math.min(180, cursor.pressMs) : cursor.pressMs,
    );
    return () => clearTimeout(timer);
  }, [pressed, activation, reduced, cursor.pressMs]);
  // The press scale is an option, so it animates from its value rather than from a fixed keyframe.
  useLayoutEffect(() => {
    if (!acknowledged || !cursor.pressMs || reduced || !glyph.current) return;
    const press = glyph.current.animate(
      [
        { transform: 'scale(1)' },
        { transform: `scale(${cursor.pressScale})`, offset: 0.3 },
        { transform: `scale(${cursor.pressScale})`, offset: 0.55 },
        { transform: 'scale(1)' },
      ],
      { duration: cursor.pressMs, easing: 'ease-in-out' },
    );
    return () => press.cancel();
  }, [acknowledged, activation?.id, reduced, cursor.pressMs, cursor.pressScale]);

  const wanted = pressed || slot.cursor.running ? slot.cursor.active : slot.cursor.shape;
  const shape = cursor.assets.has(wanted) ? wanted : 'arrow';
  const asset = cursor.assets.get(shape)!;
  return (
    <g data-vacp-phase={slot.phase}>
      <circle
        data-vacp-bloom=""
        r={cursor.bloomRadius}
        cx={cursor.size / 3}
        cy={cursor.size / 3}
        fill={cursor.bloom ?? 'none'}
        opacity={slot.phase === 'thinking' ? 0.35 : 0.18}
        {...stylex.props(styles.bloom)}
      />
      <g ref={pointer.bind('travel')} data-vacp-travel="" transform="scale(1)">
        <g
          ref={glyph}
          data-vacp-cursor=""
          data-vacp-cursor-shape={shape}
          {...stylex.props(styles.glyph, cursor.bloom !== undefined && styles.shadow)}
        >
          <path
            d={asset.path}
            fill={cursor.fill ?? asset.fill ?? 'white'}
            stroke={cursor.stroke}
            strokeWidth={cursor.strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            transform={`scale(${cursor.size / 24}) translate(${-asset.hotspot.x} ${-asset.hotspot.y})`}
          />
        </g>
      </g>
    </g>
  );
}

/** Expands once from the activation point. Reduced motion shows a short static target ring. */
export function Ripple({ slot, pointer }: { slot: Slot; pointer: PointerMotion }) {
  const { cursor } = usePresence().config;
  const { reduced } = useMotion();
  const activation = useActivation(pointer);
  const [finished, setFinished] = useState<number>();
  const shown =
    !!activation && slot.cursor.feedback && cursor.rippleSize > 0 && cursor.rippleMs > 0 && finished !== activation.id;
  useEffect(() => {
    if (!shown || !reduced) return;
    const timer = setTimeout(() => setFinished(activation.id), Math.min(180, cursor.rippleMs));
    return () => clearTimeout(timer);
  }, [shown, reduced, activation, cursor.rippleMs]);
  if (!shown) return null;
  const { x, y } = activation.point;
  return (
    <circle
      key={activation.id}
      data-vacp-ripple=""
      cx={x}
      cy={y}
      r={reduced ? Math.min(8, cursor.rippleSize / 2) : cursor.rippleSize / 2}
      fill={cursor.ripple}
      fillOpacity={0.5}
      stroke={cursor.ripple}
      strokeWidth={2}
      onAnimationEnd={() => setFinished(activation.id)}
      {...stylex.props(!reduced && styles.ripple(x, y, cursor.rippleMs))}
    />
  );
}
