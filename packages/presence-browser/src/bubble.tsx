import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import type { PresenceNavigation } from '@ethivia/vacp-presence';
import type { BubbleMotion } from './bubble-motion';
import { useMotion, usePresence } from './context';
import type { Slot } from './slots';
import type { PresenceTextProps } from './text';
import { color, ease, labelMarker, reducedMarker } from './tokens.stylex';
import { Stepper, Trail } from './trail';

const turn = stylex.keyframes({
  '0%, 30%': { transform: 'rotate(0)' },
  '60%, 100%': { transform: 'rotate(90deg)' },
});
// Each block of the mark gathers toward the centre and back, from its own corner.
const pullNorthWest = stylex.keyframes({
  '0%, 100%': { transform: 'translate(0,0)' },
  '30%, 60%': { transform: 'translate(21.1%,21.1%)' },
});
const pullNorthEast = stylex.keyframes({
  '0%, 100%': { transform: 'translate(0,0)' },
  '30%, 60%': { transform: 'translate(-21.1%,21.1%)' },
});
const pullSouthWest = stylex.keyframes({
  '0%, 100%': { transform: 'translate(0,0)' },
  '30%, 60%': { transform: 'translate(21.1%,-21.1%)' },
});
const pullSouthEast = stylex.keyframes({
  '0%, 100%': { transform: 'translate(0,0)' },
  '30%, 60%': { transform: 'translate(-21.1%,-21.1%)' },
});
const enter = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(3px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const styles = stylex.create({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 2,
    boxSizing: 'border-box',
    maxWidth: 'calc(100vw - 24px)',
    borderRadius: 14,
    isolation: 'isolate',
    color: color.ink,
    fontFamily: 'system-ui',
    fontSize: 13,
    lineHeight: 1.5,
    pointerEvents: 'none',
    overflowWrap: 'anywhere',
    willChange: 'transform',
  },
  width: (width: number) => ({ width }),
  // The stepper is the only interactive part, so the label takes pointer input only while it has one.
  interactive: { pointerEvents: 'auto' },
  // The surface shares the root's box, so its painted rectangle is the label's position.
  surface: {
    position: 'absolute',
    inset: 0,
    zIndex: -1,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.edge,
    borderRadius: 14,
    backgroundColor: color.surface,
    boxShadow: `0 4px 20px ${color.shadow}`,
    transformOrigin: 'top left',
    pointerEvents: 'none',
  },
  content: { position: 'relative', paddingBlock: 12, paddingInline: 15 },
  heading: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    marginBottom: 4,
    fontSize: 11,
    lineHeight: '16px',
    color: color.muted,
  },
  headingBesideStepper: { paddingRight: 82 },
  title: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  waiting: { minHeight: 20, color: color.muted },
  note: { marginTop: 6, fontSize: 12, lineHeight: 1.4, color: color.muted },
  message: { display: 'grid' },
  cell: { gridArea: '1 / 1', minHeight: 20, overflow: 'clip' },
  extent: { visibility: 'hidden' },
  plain: { whiteSpace: 'pre-wrap' },
  enter: {
    animationName: { default: enter, [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none' },
    animationDuration: '180ms',
    animationTimingFunction: ease.reveal,
  },
  mark: { position: 'relative', display: 'inline-grid', flex: 'none', width: 16, height: 16, color: color.agent },
  markLayer: {
    gridArea: '1 / 1',
    transition: {
      default: `opacity 220ms ${ease.out}, transform 220ms ${ease.out}`,
      [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none',
    },
  },
  markAway: { opacity: 0, transform: 'scale(.72)' },
  icon: { width: 16, height: 16 },
  gather: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24%',
    width: 12,
    height: 12,
    placeSelf: 'center',
    animationName: { default: turn, [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none' },
    animationDuration: '1600ms',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  block: {
    display: 'block',
    backgroundColor: 'currentColor',
    borderRadius: 1.7,
    animationDuration: '1600ms',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  northWest: {
    animationName: { default: pullNorthWest, [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none' },
  },
  northEast: {
    animationName: { default: pullNorthEast, [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none' },
  },
  southWest: {
    animationName: { default: pullSouthWest, [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none' },
  },
  southEast: {
    animationName: { default: pullSouthEast, [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none' },
  },
  // At rest the hidden blocks stop, so an idle label runs no animation.
  resting: { animationPlayState: 'paused' },
});

const blocks = [styles.northWest, styles.northEast, styles.southWest, styles.southEast];

/** The bot at rest; four gathering blocks while the agent thinks or acts (adapted from loading.dev; see NOTICE). */
function AgentMark({ icon, busy }: { icon: string; busy: boolean }) {
  return (
    <span data-vacp-mark="" data-busy={busy ? '' : undefined} aria-hidden="true" {...stylex.props(styles.mark)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...stylex.props(styles.markLayer, styles.icon, busy && styles.markAway)}
      >
        <path d={icon} />
      </svg>
      <span
        data-vacp-gather=""
        {...stylex.props(styles.markLayer, styles.gather, !busy && styles.markAway, !busy && styles.resting)}
      >
        {blocks.map((corner, index) => (
          <i key={index} {...stylex.props(styles.block, corner, !busy && styles.resting)} />
        ))}
      </span>
    </span>
  );
}

/** The default message view: plain text that fades in with each new message. */
function PlainText({ text, revision, animate }: PresenceTextProps) {
  return (
    <span key={revision} {...stylex.props(styles.plain, animate && styles.enter)}>
      {text}
    </span>
  );
}

/**
 * The whole message is also laid out, unseen, in the same grid cell. It sizes the label once per message,
 * so words revealed one at a time fill a box that already has its final height.
 */
function Message({ message, streaming }: { message: Slot['message']; streaming: boolean }) {
  const View = usePresence().config.text?.View ?? PlainText;
  const { reduced } = useMotion();
  return (
    <div {...stylex.props(styles.message)}>
      <div data-vacp-summary="" {...stylex.props(styles.cell)}>
        <View
          text={message.text}
          revision={message.revision}
          streaming={streaming}
          animate={message.animate && !reduced}
          reducedMotion={reduced}
        />
      </div>
      <div aria-hidden="true" inert {...stylex.props(styles.cell, styles.extent)}>
        <View text={message.text} revision={message.revision} streaming={false} animate={false} reducedMotion />
      </div>
    </div>
  );
}

/** A contextual label with a stable reading width, independent of analytical layout. */
export const Bubble = memo(function Bubble({
  slot,
  navigation,
  motion,
}: {
  slot: Slot;
  navigation: PresenceNavigation | undefined;
  motion: BubbleMotion;
}) {
  const { config } = usePresence();
  return (
    <div
      ref={motion.bind('root')}
      data-vacp-bubble=""
      aria-busy={navigation?.restoring ?? false}
      {...stylex.props(
        labelMarker,
        styles.root,
        styles.width(config.bubbleWidth),
        navigation && !slot.exiting && styles.interactive,
      )}
    >
      <div ref={motion.bind('surface')} aria-hidden="true" {...stylex.props(styles.surface)} />
      <div ref={motion.bind('content')} {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.heading, navigation && styles.headingBesideStepper)}>
          {config.icon !== false && slot.agent ? <AgentMark icon={config.icon} busy={slot.busy} /> : null}
          <span data-vacp-heading="" {...stylex.props(styles.title)}>
            {slot.heading}
          </span>
        </div>
        {slot.waiting ? (
          <div data-vacp-waiting="" {...stylex.props(styles.waiting)}>
            {slot.words}
          </div>
        ) : (
          <Message message={slot.message} streaming={slot.streaming} />
        )}
        {navigation?.diverged && slot.trail ? (
          <div data-vacp-note="" {...stylex.props(styles.note)}>
            {config.labels.diverged}
          </div>
        ) : null}
        {slot.trail && navigation ? <Trail navigation={navigation} /> : null}
        {navigation ? <Stepper navigation={navigation} /> : null}
      </div>
    </div>
  );
});
