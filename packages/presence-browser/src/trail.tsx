import * as stylex from '@stylexjs/stylex';
import { Fragment } from 'react';
import type { PresenceNavigation } from '@vacp/presence-core';
import { frameNames } from './describe';
import { color, ease, labelMarker, reducedMarker } from './tokens.stylex';

// Hover shades apply only where a precise pointer can hover.
const hover = '@media (hover: hover) and (pointer: fine)';

const styles = stylex.create({
  rail: { display: 'flex', alignItems: 'center', marginTop: 9, marginBottom: 1, marginLeft: -3 },
  link: { flex: '1 1 14px', minWidth: 4, maxWidth: 22, height: 1, backgroundColor: color.rail },
  linkPast: { backgroundColor: color.railPast },
  mark: {
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
    width: 16,
    height: 16,
    padding: 0,
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: 'transparent',
    color: { default: color.railPast, [hover]: { ':hover': color.control } },
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.focus}` },
    outlineOffset: 1,
  },
  markUnavailable: { cursor: 'default' },
  // A mark's state owns its whole colour, including the hover shade, because StyleX merges by property.
  markPast: { color: { default: color.markPast, [hover]: { ':hover': color.control } } },
  markCurrent: { color: color.agent },
  markWaiting: { color: color.railPast },
  markWaitingPast: { color: color.markPast },
  shape: {
    display: 'block',
    boxSizing: 'border-box',
    transition: {
      default: `transform 160ms ${ease.out}, background-color 160ms ease, border-color 160ms ease`,
      [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none',
    },
  },
  // The rail names every frame by shape: a ring where the request began, a dot per step, and a diamond
  // where it concluded. Earlier frames stay darker than later ones, so the rail reads as progress.
  start: {
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: 'currentColor',
    borderRadius: '50%',
  },
  step: { width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' },
  conclusion: { width: 7, height: 7, borderRadius: 1, backgroundColor: 'currentColor', transform: 'rotate(45deg)' },
  currentShape: { transform: 'scale(1.3)' },
  currentConclusion: { transform: 'rotate(45deg) scale(1.3)' },
  stepper: {
    position: 'absolute',
    right: 7,
    top: 5,
    display: 'flex',
    gap: 1,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', labelMarker)]: 1,
      [stylex.when.ancestor(':focus-within', labelMarker)]: 1,
      '@media (hover: none)': 1,
    },
    transition: { default: 'opacity 160ms ease', [stylex.when.ancestor('[data-reduced]', reducedMarker)]: 'none' },
  },
  control: {
    display: 'grid',
    placeItems: 'center',
    width: 26,
    height: 27,
    padding: 4,
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: 'transparent', ':hover': color.wash },
    color: { default: color.control, ':hover': color.controlActive },
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.focus}` },
    outlineOffset: 1,
  },
  controlUnavailable: { backgroundColor: 'transparent', color: color.control, cursor: 'default', opacity: 0.3 },
});

/**
 * Unavailable controls stay focusable, so keyboard focus survives every step an agent takes. Their
 * callbacks already ignore a request they cannot take.
 */
function unavailable(value: boolean) {
  return value ? { 'aria-disabled': true as const } : {};
}

const shapes = { start: styles.start, step: styles.step, conclusion: styles.conclusion } as const;

/** Why stepping is unavailable while live work runs. */
const waiting = 'Stepping resumes when the agent finishes';

/** Every frame of the request, clickable, below the words it frames. */
export function Trail({ navigation }: { navigation: PresenceNavigation }) {
  const names = frameNames(navigation.frames);
  return (
    <div role="group" aria-label="Request trail" data-vacp-trail="" {...stylex.props(styles.rail)}>
      {navigation.frames.map((frame, index) => {
        const current = index === navigation.index;
        const past = index < navigation.index;
        return (
          // The k-th step keeps its key as later steps join, so focus stays on the frame it was on.
          <Fragment key={frame === 'step' ? names[index] : frame}>
            {index ? <span {...stylex.props(styles.link, past && styles.linkPast)} /> : null}
            <button
              type="button"
              aria-label={names[index]}
              title={navigation.working && !current ? waiting : names[index]}
              aria-current={current ? 'step' : undefined}
              {...unavailable(navigation.restoring || navigation.working || current)}
              onClick={() => navigation.go(index)}
              {...stylex.props(
                styles.mark,
                (navigation.restoring || navigation.working || current) && styles.markUnavailable,
                past && styles.markPast,
                (navigation.restoring || navigation.working) && (past ? styles.markWaitingPast : styles.markWaiting),
                current && styles.markCurrent,
              )}
            >
              <i
                {...stylex.props(
                  styles.shape,
                  shapes[frame],
                  current && (frame === 'conclusion' ? styles.currentConclusion : styles.currentShape),
                )}
              />
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function Chevron({ path }: { path: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Step through the request, or leave it. With nowhere to step, such as a single recorded step or a closing
 * answer, only dismissal remains. Reviewing returns to the live analysis; otherwise the same control
 * dismisses the retained step.
 */
export function Stepper({ navigation }: { navigation: PresenceNavigation }) {
  // Arrows belong to a request with somewhere to step, even while live work keeps them waiting.
  const stepping = navigation.reviewing || navigation.frames.length > 1;
  const close = navigation.reviewing ? 'Return to live analysis' : 'Dismiss';
  return (
    <nav aria-label="Analytical trail" {...stylex.props(styles.stepper)}>
      {stepping ? (
        <>
          <button
            type="button"
            title={navigation.working ? waiting : 'Previous analytical step'}
            aria-label="Previous analytical step"
            {...unavailable(!navigation.canBack)}
            onClick={navigation.back}
            {...stylex.props(styles.control, !navigation.canBack && styles.controlUnavailable)}
          >
            <Chevron path="M15 5l-7 7 7 7" />
          </button>
          <button
            type="button"
            title={navigation.working ? waiting : 'Next analytical step'}
            aria-label="Next analytical step"
            {...unavailable(!navigation.canForward)}
            onClick={navigation.forward}
            {...stylex.props(styles.control, !navigation.canForward && styles.controlUnavailable)}
          >
            <Chevron path="M9 5l7 7-7 7" />
          </button>
        </>
      ) : null}
      <button
        type="button"
        title={close}
        aria-label={close}
        {...unavailable(navigation.restoring)}
        onClick={navigation.close}
        {...stylex.props(styles.control, navigation.restoring && styles.controlUnavailable)}
      >
        <Chevron path="M6 6l12 12M18 6L6 18" />
      </button>
    </nav>
  );
}
