import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import type { PresenceNavigation } from '@ethivia/vacp-presence-core';
import { Bubble } from './bubble';
import { usePresence } from './context';
import { Cursor, Ripple } from './cursor';
import type { PointerMotion } from './pointer-motion';
import type { Slot } from './slots';

const styles = stylex.create({
  // Cues and ripples paint below cursors, and cursors below every label.
  cues: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    display: 'block',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  layer: { position: 'absolute', left: 0, top: 0, zIndex: 1, willChange: 'transform', pointerEvents: 'none' },
  glyph: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible' },
});

/** One actor's cursor, target outline, and label. Its motion controller positions them. */
export const Pointer = memo(function Pointer({
  slot,
  navigation,
  pointer,
}: {
  slot: Slot;
  navigation: PresenceNavigation | undefined;
  pointer: PointerMotion;
}) {
  const { config } = usePresence();
  return (
    <>
      <svg aria-hidden="true" {...stylex.props(styles.cues)}>
        <path ref={pointer.bind('cue')} fill="none" stroke={config.cue.color} strokeWidth={1} />
        <Ripple slot={slot} pointer={pointer} />
      </svg>
      <div ref={pointer.bind('layer')} {...stylex.props(styles.layer)}>
        <div ref={pointer.bind('float')}>
          <svg aria-hidden="true" {...stylex.props(styles.glyph)}>
            <Cursor slot={slot} pointer={pointer} />
          </svg>
        </div>
      </div>
      {config.bubble ? <Bubble slot={slot} navigation={navigation} motion={pointer.bubble} /> : null}
    </>
  );
});
