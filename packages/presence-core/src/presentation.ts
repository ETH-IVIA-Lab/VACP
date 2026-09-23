import { provenanceActor, provenanceFocus, provenanceMessage, type ProvenanceCheckpoint } from '@vacp/provenance-core';
import type { PresenceActivity, PresenceFrame, PresenceOptions, PresenceTarget } from './types';
import { isAgentActor } from './types';
import type { PresenceFocus } from './targets';
import { presenceSubject } from './subject';
import { createTargetTracker } from './tracker';

/** Select one presentation without giving the renderer knowledge of history or restoration. */
export function createPresencePresentation(
  options: PresenceOptions,
  resolve: (focus: PresenceFocus, signal: AbortSignal) => Promise<PresenceTarget | null>,
  report: (error: unknown) => void,
) {
  const includes = options.includeActor ?? isAgentActor;
  const replay = options.replay;
  const lifetime = new AbortController();
  let state = replay?.getState();
  const visibleCheckpoint = (step: ProvenanceCheckpoint) =>
    step.position === 'after' && includes(provenanceActor(step.record));
  let visibleSteps = state?.steps.filter(visibleCheckpoint) ?? [];
  let navigation: PresenceFrame['navigation'];
  let live: readonly PresenceActivity[] = [];
  let completion: PresenceActivity | undefined;
  let recorded: { id: string; activity: PresenceActivity } | undefined;
  let shown = false;
  /**
   * The trail stays hidden after the person dismisses it or changes the analysis themselves, until
   * the agent records a new step or, for a dismissal, starts new work.
   */
  let hidden: 'dismissed' | 'superseded' | undefined;
  const active = (activity: PresenceActivity) => activity.phase === 'thinking' || activity.phase === 'acting';
  const updateNavigation = () => {
    const steps = visibleSteps;
    const selectedId = state?.selected?.id;
    // A selection made elsewhere may lie outside this viewer's trail; it then has no neighbours here.
    const at = selectedId ? steps.findIndex((step) => step.id === selectedId) : -1;
    const position = at >= 0 ? at : state?.latest?.id === steps.at(-1)?.id ? steps.length - 1 : steps.length;
    const busy = state?.phase === 'restoring';
    const previous = at >= 0 || !selectedId ? steps[position - 1] : undefined;
    const next = at >= 0 ? steps[at + 1] : undefined;
    navigation =
      state && replay && (steps.length > 0 || state.phase !== 'live')
        ? {
            canBack: !busy && !!previous,
            canForward: !busy && !!next,
            reviewing: state.phase !== 'live',
            restoring: !!busy,
            position: { index: Math.max(0, Math.min(position, steps.length - 1)) + 1, count: steps.length },
            back: () => {
              if (lifetime.signal.aborted || !previous || busy) return;
              hidden = undefined;
              void replay.review(previous.id).catch(report);
            },
            forward: () => {
              if (lifetime.signal.aborted || !next || busy) return;
              hidden = undefined;
              void replay.review(next.id).catch(report);
            },
            close: () => {
              if (lifetime.signal.aborted || busy) return;
              hidden = 'dismissed';
              if (state?.phase === 'live') present();
              else void replay.close().catch(report);
            },
          }
        : undefined;
  };
  updateNavigation();
  const render = (activities: readonly PresenceActivity[], reason: PresenceFrame['reason']) => {
    if (lifetime.signal.aborted) return;
    shown = activities.length > 0;
    try {
      options.renderer?.render({ activities, reason, navigation });
    } catch (error) {
      report(error);
    }
  };
  const recordedTargets = createTargetTracker(
    resolve,
    (target, reason) => {
      if (!recorded) return;
      recorded.activity = { ...recorded.activity, target };
      render([recorded.activity], reason);
    },
    report,
  );
  const clearRecorded = () => {
    recordedTargets.cancel();
    recorded = undefined;
  };
  const present = (reason: PresenceFrame['reason'] = 'activity') => {
    const selected = state?.selected ?? visibleSteps.at(-1);
    // A hidden trail still shows work in progress; finished live entries wait with the trail. A
    // dismissal made while reviewing keeps the reviewed step until the controller leaves review.
    const shownLive = hidden ? live.filter(active) : live;
    const trailHidden = hidden === 'superseded' ? state?.phase === 'live' : !!hidden && state?.phase !== 'reviewing';
    if (!state || trailHidden || (state.phase === 'live' && shownLive.length)) {
      clearRecorded();
      render(shownLive, reason);
      return;
    }
    if (!selected || !includes(provenanceActor(selected.record))) {
      clearRecorded();
      render([], reason);
      return;
    }
    const execution = selected.record.kind === 'action' ? selected.record.execution : undefined;
    const retained =
      state.phase === 'live' && completion?.actor.id === provenanceActor(selected.record).id ? completion : undefined;
    const changed = recorded?.id !== selected.id;
    if (changed) clearRecorded();
    const focus = provenanceFocus(selected.record);
    const activity: PresenceActivity = {
      actor: retained?.actor ?? provenanceActor(selected.record),
      recordId: selected.id,
      phase: state.phase === 'live' ? 'completed' : 'reviewing',
      subject: presenceSubject(selected.observation.graph, focus?.ref ?? execution?.intent?.affects?.[0]),
      summary: state.error
        ? 'This step could not be fully restored.'
        : (retained?.summary ?? provenanceMessage(selected.record)),
      execution,
      target: recorded?.activity.target ?? null,
      freshness: 'unknown',
    };
    recorded = { id: selected.id, activity };
    render([activity], reason);
    if (!changed && reason !== 'layout') return;
    const sourceId = focus && selected.observation.graph.ownership.nodes[focus.ref];
    if (!focus || !sourceId) return recordedTargets.cancel();
    recordedTargets.track({ focus, sourceId }, reason, lifetime.signal);
  };
  const release = replay?.subscribe(() => {
    const previous = state?.latest?.id;
    const previousSteps = state?.steps;
    state = replay.getState();
    if (state.steps !== previousSteps) visibleSteps = state.steps.filter(visibleCheckpoint);
    updateNavigation();
    if (state.latest && state.latest.id !== previous) {
      // A person's change retires agent feedback; the runtime's own observations leave it in place.
      const actor = provenanceActor(state.latest.record);
      if (includes(actor)) hidden = undefined;
      else if (actor.kind !== 'system') hidden = 'superseded';
    }
    present();
  });
  // A new viewer shows the retained checkpoint without waiting for unrelated activity.
  if (state) present();
  return {
    update(activities: readonly PresenceActivity[], reason: PresenceFrame['reason'], activityEvent = false) {
      // New agent events supersede retained checkpoints; a dismissal lifts only when new work begins.
      if (activityEvent && (hidden === 'superseded' || activities.some(active))) hidden = undefined;
      live = activities;
      if (activities.some(active)) completion = undefined;
      completion = activities.find((activity) => activity.phase === 'completed' && activity.summary) ?? completion;
      present(reason);
    },
    // Layout cannot change an empty presentation; skipping it keeps human interaction free of lookups.
    invalidate: () => {
      if (shown) present('layout');
    },
    dispose() {
      lifetime.abort();
      clearRecorded();
      release?.();
    },
  };
}
