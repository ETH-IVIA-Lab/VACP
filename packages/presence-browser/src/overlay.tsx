import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import type { PresenceNavigation } from '@ethivia/vacp-presence';
import { useMotion, usePresence } from './context';
import { Pointer } from './pointer';
import type { PointerMotion } from './pointer-motion';
import type { Slot } from './slots';
import { reducedMarker } from './tokens.stylex';

const styles = stylex.create({
  // The host's inline style cannot hold a media query, so the root leaves print with every cursor and bubble.
  root: { position: 'absolute', inset: 0, pointerEvents: 'none', display: { default: null, '@media print': 'none' } },
  status: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' },
});

/** Announces what each actor is doing. Streamed text settles first, so a screen reader hears it once. */
function Announcer({ slots }: { slots: readonly Slot[] }) {
  const { text } = usePresence().config;
  const present = slots.filter((slot) => !slot.exiting);
  const lines = present.map((slot) => `${slot.speaker}: ${slot.words}`).join('\n');
  const settled = present.map((slot) => `${slot.speaker}: ${text?.speak?.(slot.words) ?? slot.words}`).join('\n');
  const [spoken, setSpoken] = useState('');
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => setSpoken(settled), 500);
    return () => clearTimeout(timer);
  }, [text, settled]);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" {...stylex.props(styles.status)}>
      {text ? spoken : lines}
    </div>
  );
}

/** A passive overlay. It never dispatches input, moves focus, or scrolls the application. */
export function PresenceOverlay({
  slots,
  navigation,
  pointers,
}: {
  slots: readonly Slot[];
  navigation: PresenceNavigation | undefined;
  pointers: ReadonlyMap<number, PointerMotion>;
}) {
  const { reduced } = useMotion();
  return (
    <div data-reduced={reduced ? '' : undefined} {...stylex.props(reducedMarker, styles.root)}>
      {slots.map((slot) => (
        <Pointer key={slot.id} slot={slot} navigation={navigation} pointer={pointers.get(slot.id)!} />
      ))}
      <Announcer slots={slots} />
    </div>
  );
}
