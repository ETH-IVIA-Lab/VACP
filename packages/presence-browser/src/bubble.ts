import type { PresenceTextFactory } from './text';
import { createNarration } from './narration';
import { crossesTarget, placeBubble, pushOut, targetBounds, type BubblePlacement } from './bubble-layout';
import type { PresenceActivity, PresenceGeometry, PresencePoint, PresenceNavigation } from '@vacp/presence-core';
import { agentIcon, markStyle } from './bubble-assets';

export function actorLabel(actor: PresenceActivity['actor']): string {
  return actor.label ?? (actor.kind === 'human' ? 'You' : actor.kind === 'agent' ? 'Agent' : 'System');
}

/** Wording when the agent has said nothing: what is happening to which view, never a phase name. */
export function describePresence(activity: PresenceActivity): string {
  if (activity.summary) return activity.summary;
  const view = activity.subject ?? 'the view';
  const change = activity.execution?.title;
  if (activity.phase === 'thinking') return `Looking at ${view}`;
  if (activity.phase === 'failed') return `${change ?? 'The change'} could not be applied to ${view}`;
  if (activity.phase === 'cancelled') return `Stopped before changing ${view}`;
  if (activity.freshness === 'error') return `${view} could not finish updating`;
  if (activity.freshness === 'updating') return `${view} is still updating`;
  if (activity.phase === 'completed' || activity.phase === 'reviewing')
    return change ? `${change} applied to ${view}` : `Updated ${view}`;
  return change ? `${change} in ${view}` : `Updating ${view}`;
}

/** A contextual label with a stable reading width, independent of analytical layout. */
export function createPresenceBubble(
  host: ShadowRoot,
  width: number,
  textFactory?: PresenceTextFactory,
  icon: string | false = agentIcon,
) {
  const doc = host.ownerDocument;
  const bubble = doc.createElement('div');
  bubble.dataset.vacpBubble = '';
  bubble.style.cssText = `position:absolute;left:0;top:0;box-sizing:border-box;width:${width}px;max-width:calc(100vw - 24px);padding:12px 15px;border:1px solid transparent;border-radius:14px;isolation:isolate;color:#202124;font:13px/1.5 system-ui;pointer-events:none;overflow-wrap:anywhere;will-change:transform;`;
  const css = doc.createElement('style');
  css.textContent = `[data-vacp-bubble] .vacp-stepper{position:absolute;right:7px;top:5px;display:flex;opacity:0;transition:opacity 160ms ease;gap:1px}[data-vacp-bubble]:hover .vacp-stepper,[data-vacp-bubble]:focus-within .vacp-stepper{opacity:1}.vacp-stepper button{display:grid;place-items:center;width:26px;height:27px;border:0;border-radius:5px;background:transparent;color:#64748b;cursor:pointer;padding:4px}.vacp-stepper button:hover{background:#f1f5f9;color:#334155}.vacp-stepper button:focus-visible{outline:2px solid #60a5fa;outline-offset:1px}.vacp-stepper button:disabled{opacity:.3;cursor:default}.vacp-stepper button[hidden]{display:none}@media(hover:none){[data-vacp-bubble] .vacp-stepper{opacity:1}}@media(prefers-reduced-motion:reduce){[data-vacp-bubble] .vacp-stepper{transition:none}}${markStyle}`;
  const surface = doc.createElement('div');
  surface.setAttribute('aria-hidden', 'true');
  surface.style.cssText =
    'position:absolute;inset:0;z-index:-1;border:1px solid rgba(0,0,0,.08);border-radius:14px;background:rgba(255,255,255,.97);box-shadow:0 4px 20px rgba(25,45,70,.10);transform-origin:top left;pointer-events:none';
  bubble.append(css, surface);
  const navigation = doc.createElement('nav');
  navigation.className = 'vacp-stepper';
  navigation.setAttribute('aria-label', 'Analytical trail');
  navigation.hidden = true;
  const button = (label: string, path: string) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.title = label;
    element.setAttribute('aria-label', label);
    element.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
    navigation.append(element);
    return element;
  };
  const back = button('Previous analytical step', 'M15 5l-7 7 7 7');
  const forward = button('Next analytical step', 'M9 5l7 7-7 7');
  const close = button('Return to live analysis', 'M6 6l12 12M18 6L6 18');
  const heading = doc.createElement('div');
  heading.style.cssText =
    'display:flex;align-items:center;gap:7px;font-size:11px;line-height:16px;color:#697386;margin-bottom:4px';
  const mark = doc.createElement('span');
  mark.className = 'vacp-agent-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.hidden = true;
  if (icon) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', icon);
    svg.append(path);
    const gather = doc.createElement('span');
    gather.className = 'vacp-gather';
    for (const [x, y] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const block = doc.createElement('i');
      block.style.setProperty('--vacp-x', String(x));
      block.style.setProperty('--vacp-y', String(y));
      gather.append(block);
    }
    mark.append(svg, gather);
  }
  const label = doc.createElement('span');
  label.className = 'vacp-heading-label';
  heading.append(mark, label);
  // Before public progress exists, the waiting text holds the narration's place while the mark works.
  const waiting = doc.createElement('div');
  waiting.className = 'vacp-waiting';
  waiting.hidden = true;
  const waitingLabel = doc.createElement('span');
  waiting.append(waitingLabel);
  const text = doc.createElement('div');
  text.dataset.vacpSummary = '';
  text.style.cssText = 'min-height:20px;overflow:clip';
  const content = doc.createElement('div');
  if (!textFactory) content.style.whiteSpace = 'pre-wrap';
  text.append(content);
  bubble.append(heading, waiting, text, navigation);
  host.append(bubble);
  const textRenderer = textFactory?.(content);
  let animation: Animation | undefined;
  let resizeAnimations: Animation[] = [];
  let latestReduced = false;
  const narration = createNarration();
  let lastLayout:
    | { point: PresencePoint; viewport: { width: number; height: number }; beside: PresenceGeometry | undefined }
    | undefined;
  let movement: Animation | undefined;
  let placement: BubblePlacement | undefined;
  /** Painted under a travelling cursor, away from the last settled placement. */
  let riding = false;

  const measure = (viewport: { width: number }) => {
    const w = Math.min(width, Math.max(0, viewport.width - 24));
    if (dirty || measuredWidth !== w) {
      height = bubble.offsetHeight;
      measuredWidth = w;
      dirty = false;
    }
    return w;
  };
  let navigable = false;
  let pending = false;
  let position: PresenceNavigation['position'] | undefined;
  let measuredWidth = 0,
    height = 0;
  let dirty = true;
  const api = {
    element: bubble,
    readText: () =>
      pending ? waitingLabel.textContent! : (textRenderer?.readText?.() ?? content.innerText) || narration.read(),
    navigate(state: PresenceNavigation | undefined) {
      const enabled = !!state;
      position = state?.position;
      // Derived every frame, so an interrupted exit cannot leave the stepper unclickable.
      bubble.style.pointerEvents = enabled ? 'auto' : 'none';
      if (enabled !== navigable) {
        navigable = enabled;
        navigation.hidden = !enabled;
        navigation.style.display = enabled ? 'flex' : 'none';
        heading.style.paddingRight = enabled ? '82px' : '0';
        dirty = true;
      }
      // A single recorded step has nowhere to step to; only its dismissal remains.
      back.hidden = forward.hidden = (state?.position.count ?? 0) < 2;
      back.disabled = !state?.canBack;
      forward.disabled = !state?.canForward;
      // Reviewing returns to the live analysis; otherwise the same control dismisses the retained step.
      const closeLabel = state?.reviewing ? 'Return to live analysis' : 'Dismiss';
      if (close.title !== closeLabel) {
        close.title = closeLabel;
        close.setAttribute('aria-label', closeLabel);
      }
      close.disabled = state?.restoring ?? false;
      bubble.setAttribute('aria-busy', String(state?.restoring ?? false));
      back.onclick = state?.back ?? null;
      forward.onclick = state?.forward ?? null;
      close.onclick = state?.close ?? null;
    },
    update(activity: PresenceActivity, words: string, reduced: boolean) {
      latestReduced = reduced;
      // The heading names the view being worked on, or the place in the trail; the mark carries the state.
      const title =
        activity.phase === 'reviewing' && position
          ? `Step ${position.index} of ${position.count}`
          : activity.phase === 'failed'
            ? `${activity.subject ?? 'This step'} could not be completed`
            : activity.phase === 'cancelled'
              ? 'Stopped'
              : (activity.subject ?? (activity.actor.kind === 'agent' ? '' : actorLabel(activity.actor)));
      if (label.textContent !== title) {
        label.textContent = title;
        dirty = true;
      }
      const agent = !!icon && activity.actor.kind === 'agent';
      if (mark.hidden === agent) {
        mark.hidden = !agent;
        dirty = true;
      }
      mark.toggleAttribute('data-busy', activity.phase === 'thinking' || activity.phase === 'acting');
      bubble.toggleAttribute('data-reduced', reduced);
      const waitingNow = activity.phase === 'thinking' && !activity.summary;
      if (waitingNow !== pending) {
        pending = waitingNow;
        waiting.hidden = !pending;
        text.hidden = pending;
        dirty = true;
      }
      if (pending) {
        if (waitingLabel.textContent !== words) {
          waitingLabel.textContent = words;
          dirty = true;
        }
        return words;
      }
      const next = narration.update(activity, words);
      if (next.changed && !textRenderer) {
        // An incremental renderer commits later; its resize reaches the layout observer.
        dirty = true;
        animation?.cancel();
        content.textContent = next.text;
        if (!reduced && next.animate)
          animation = content.animate(
            [
              { opacity: 0, transform: 'translateY(3px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' },
          );
      }
      textRenderer?.render({
        text: next.text,
        revision: next.revision,
        streaming: !!activity.summary && (activity.phase === 'thinking' || activity.phase === 'acting'),
        reducedMotion: reduced,
      });
      return next.text;
    },
    /** Settle beside `beside`, or beside the cursor point when the step has no located geometry. */
    place(
      point: PresencePoint,
      viewport: { width: number; height: number },
      beside: PresenceGeometry | undefined,
      reduced: boolean,
    ) {
      lastLayout = { point, viewport, beside };
      const w = measure(viewport);
      const target = beside ? targetBounds(beside) : { x: point.x - 12, y: point.y - 12, width: 24, height: 24 };
      // An interrupted movement or a ride needs the painted position; otherwise the last placement is exact.
      const painted = riding || movement?.playState === 'running';
      const bounds = placement && !painted ? placement : bubble.getBoundingClientRect();
      const from = { x: bounds.x, y: bounds.y, width: bounds.width, height: placement?.height ?? bounds.height };
      const sizeChanged = placement && placement.height !== height;
      // Every step, live or recorded, places the label beside the cursor that performed it. The side
      // follows the last settled step, never the ride, so a revisited step lands in the same spot.
      const next = placeBubble(target, point, { width: w, height }, viewport, placement);
      if (!riding && placement?.x === next.x && placement.y === next.y && !sizeChanged) return;
      riding = false;
      movement?.cancel();
      for (const motion of resizeAnimations) motion.cancel();
      resizeAnimations = [];
      bubble.style.transform = `translate(${next.x}px,${next.y}px)`;
      if (placement && !reduced && sizeChanged && !crossesTarget(from, next, target)) {
        // FLIP the painted surface and text; the layout reaches its final size once.
        const shift = `translate(${from.x - next.x}px,${from.y - next.y}px)`;
        const timing = { duration: 200, easing: 'cubic-bezier(.22,1,.36,1)' };
        resizeAnimations = [
          surface.animate([{ transform: `${shift} scaleY(${from.height / height})` }, { transform: 'none' }], timing),
          ...[heading, text, navigation].map((element) =>
            element.animate([{ transform: shift }, { transform: 'none' }], timing),
          ),
        ];
      } else if (placement && !reduced) {
        movement = bubble.animate(
          crossesTarget(from, next, target)
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { transform: `translate(${from.x}px,${from.y}px)` },
                { transform: `translate(${next.x}px,${next.y}px)` },
              ],
          { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' },
        );
      }
      placement = next;
    },
    /**
     * Carry the label under a travelling cursor, clear of the region it is heading for. `place()`
     * chooses where it settles on arrival.
     */
    ride(point: PresencePoint, viewport: { width: number; height: number }, ahead?: PresenceGeometry) {
      const w = measure(viewport);
      const within = { x: 12, y: 12, width: viewport.width - 24, height: viewport.height - 24 };
      let rect = { x: point.x - w / 2, y: point.y + 32, width: w, height };
      rect.x = Math.max(within.x, Math.min(within.x + within.width - w, rect.x));
      rect.y = Math.max(within.y, Math.min(within.y + within.height - height, rect.y));
      if (ahead) rect = pushOut(rect, targetBounds(ahead), within);
      const { x, y } = rect;
      if (!riding) {
        // Height changes mid-flight only reposition once the cursor settles.
        lastLayout = undefined;
        movement?.cancel();
        for (const motion of resizeAnimations) motion.cancel();
        resizeAnimations = [];
        riding = true;
      }
      bubble.style.transform = `translate(${x}px,${y}px)`;
    },
    stop() {
      animation?.cancel();
      for (const motion of resizeAnimations) motion.cancel();
      movement?.cancel();
    },
    remove() {
      layoutObserver.disconnect();
      textRenderer?.dispose();
      animation?.cancel();
      for (const motion of resizeAnimations) motion.cancel();
      movement?.cancel();
      bubble.remove();
    },
  };
  const layoutObserver = new ResizeObserver(([entry]) => {
    // The observed border box is the committed height; reading it again would force layout.
    const size = entry?.borderBoxSize[0]?.blockSize;
    if (size === undefined) dirty = true;
    else if (Math.round(size) === height) return;
    else height = Math.round(size);
    if (lastLayout) api.place(lastLayout.point, lastLayout.viewport, lastLayout.beside, latestReduced);
  });
  layoutObserver.observe(bubble);
  return api;
}
