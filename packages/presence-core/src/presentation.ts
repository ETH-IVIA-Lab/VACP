import { type ProvenanceCheckpoint, type ProvenanceReplayState } from '@ethivia/vacp-provenance-core';
import {
  provenanceActor,
  provenanceFocus,
  provenanceTurn,
  type VacpActor,
  type VacpTurnRecord,
} from '@ethivia/vacp-protocol';
import type { PresenceActivity, PresenceFrame, PresenceNavigation, PresenceOptions } from './types';
import { isAgentActor, samePresenceActivity } from './types';
import { stepPlaces, type PresenceFocus } from './targets';
import { stepSubject } from './subject';
import { createTargetTracker } from './tracker';

/** How a request ended: a recorded turn, or, without a replay controller, a turn that answered without a step. */
type Conclusion = {
  id: string;
  actor: VacpActor;
  outcome: VacpTurnRecord['outcome'];
  message?: string;
  opening?: string;
};
/** One frame of the shown request: the state it began from, a step, or its conclusion. */
type TrailFrame =
  | { kind: 'start'; checkpoint: ProvenanceCheckpoint }
  | { kind: 'step'; checkpoint: ProvenanceCheckpoint }
  | { kind: 'conclusion'; conclusion: Conclusion };
type Trail = { frames: readonly TrailFrame[]; actor?: VacpActor; opening?: string };

const empty: Trail = { frames: [] };

const concluded = (turn: VacpTurnRecord): Conclusion => ({
  id: turn.id,
  actor: turn.actor,
  outcome: turn.outcome,
  message: turn.message,
  opening: turn.opening,
});

/**
 * The request to show: the latest one, by journal order. A request is a turn's steps, or a turn that
 * completed with an answer and no step. A step's turn recorded before a later turn is superseded by it.
 */
function latestRequest(steps: readonly ProvenanceCheckpoint[], turns: readonly VacpTurnRecord[]): string | undefined {
  const step = steps.at(-1);
  const last = turns.at(-1);
  if (!step) return last?.activityId;
  const turn = provenanceTurn(step.record);
  if (turn === undefined) return last && last.at > step.record.at ? last.activityId : undefined;
  let index = turns.length - 1;
  while (index >= 0 && turns[index]!.activityId !== turn) index--;
  return index >= 0 && index < turns.length - 1 ? last!.activityId : turn;
}

/** Select one presentation without giving the renderer knowledge of history or restoration. */
export function createPresencePresentation(
  options: PresenceOptions,
  targets: Parameters<typeof createTargetTracker>[0],
  report: (error: unknown) => void,
) {
  const includes = options.includeActor ?? isAgentActor;
  const replay = options.replay;
  const lifetime = new AbortController();
  let state: ProvenanceReplayState | undefined = replay?.getState();
  let visibleSteps: readonly ProvenanceCheckpoint[] = [];
  let visibleFrom: ProvenanceReplayState['steps'] | undefined;
  let trail = empty;
  let trailFrom: readonly unknown[] = [];
  let live: readonly PresenceActivity[] = [];
  /** Without a replay controller, the closing words of a turn that took no step. Nothing recorded holds them. */
  let answer: PresenceActivity | undefined;
  let recorded: { id: string; activity: PresenceActivity; places: readonly PresenceFocus[] } | undefined;
  let rendered: { activities: readonly PresenceActivity[]; navigation: PresenceNavigation | undefined } | undefined;
  let navigation: PresenceNavigation | undefined;
  /**
   * The trail stays hidden after the person dismisses it or changes the analysis themselves, until
   * the agent records a new step or, for a dismissal, starts new work.
   */
  let hidden: 'dismissed' | 'superseded' | undefined;
  const active = (activity: PresenceActivity) => activity.phase === 'thinking' || activity.phase === 'acting';
  /** An agent's turn is open or another actor's change is not yet in the trail, so stepping waits. */
  const working = () => !!state?.working || live.some(active);
  const reviewing = () => !!state && state.phase !== 'live';

  const buildTrail = (): Trail => {
    if (!state) {
      if (!answer) return empty;
      const id = answer.activityId ?? 'answer';
      const outcome = answer.phase === 'failed' || answer.phase === 'cancelled' ? answer.phase : 'completed';
      return {
        actor: answer.actor,
        frames: [{ kind: 'conclusion', conclusion: { id, actor: answer.actor, outcome, message: answer.summary } }],
      };
    }
    // A turn without steps is a request only when it completed with an answer.
    const stepped = new Set(visibleSteps.map((step) => provenanceTurn(step.record)));
    const turns = state.turns.filter(
      (turn) =>
        includes(turn.actor) &&
        (stepped.has(turn.activityId) || (turn.outcome === 'completed' && turn.message !== undefined)),
    );
    const key = latestRequest(visibleSteps, turns);
    const steps = visibleSteps.filter((step) => provenanceTurn(step.record) === key);
    let turn: VacpTurnRecord | undefined;
    for (let index = turns.length - 1; index >= 0 && !turn; index--)
      if (turns[index]!.activityId === key) turn = turns[index];
    const first = steps[0];
    const before = first ? state.steps[state.steps.indexOf(first) - 1] : undefined;
    return {
      actor: first ? provenanceActor(first.record) : turn?.actor,
      opening: turn?.opening,
      frames: [
        ...(before ? [{ kind: 'start' as const, checkpoint: before }] : []),
        ...steps.map((checkpoint) => ({ kind: 'step' as const, checkpoint })),
        ...(turn ? [{ kind: 'conclusion' as const, conclusion: concluded(turn) }] : []),
      ],
    };
  };
  /** Live shows the request's last frame; review shows the frame of the checkpoint being restored. */
  const frameIndex = () => {
    if (!state || state.phase === 'live' || !state.selected) return trail.frames.length - 1;
    const id = state.selected.id;
    return trail.frames.findIndex((frame) => frame.kind !== 'conclusion' && frame.checkpoint.id === id);
  };

  // Stable callbacks read the presentation as it is when the person acts.
  const go = (target: number) => {
    const frame = trail.frames[target];
    if (lifetime.signal.aborted || !replay || state?.phase === 'restoring' || working()) return;
    if (!frame || target === frameIndex()) return;
    hidden = undefined;
    // The conclusion is the live state the request left behind, which leaving review restores.
    if (frame.kind === 'conclusion') {
      if (reviewing()) void replay.close().catch(report);
    } else void replay.review(frame.checkpoint.id).catch(report);
  };
  const back = () => go(frameIndex() - 1);
  const forward = () => go(frameIndex() + 1);
  const close = () => {
    if (lifetime.signal.aborted || state?.phase === 'restoring') return;
    hidden = 'dismissed';
    if (reviewing()) void replay!.close().catch(report);
    else present();
  };
  const refresh = () => {
    if (state?.steps !== visibleFrom) {
      visibleFrom = state?.steps;
      visibleSteps =
        state?.steps.filter((step) => step.position === 'after' && includes(provenanceActor(step.record))) ?? [];
    }
    const inputs = [visibleSteps, state?.turns, answer];
    if (inputs.some((input, index) => input !== trailFrom[index])) {
      trailFrom = inputs;
      trail = buildTrail();
    }
    const frames = trail.frames.map((frame) => frame.kind);
    const index = frameIndex();
    const restoring = state?.phase === 'restoring';
    const waiting = working();
    const diverged = state?.phase === 'error';
    const stepping = !!replay && !restoring && !waiting;
    const current = navigation;
    if (!frames.length) navigation = undefined;
    else if (
      !current ||
      current.index !== index ||
      current.restoring !== restoring ||
      current.working !== waiting ||
      current.diverged !== diverged ||
      current.reviewing !== reviewing() ||
      current.frames.length !== frames.length ||
      current.frames.some((kind, position) => kind !== frames[position])
    )
      navigation = Object.freeze({
        frames: Object.freeze(frames),
        index,
        canBack: stepping && index > 0,
        canForward: stepping && index >= 0 && index < frames.length - 1,
        reviewing: reviewing(),
        restoring,
        working: waiting,
        diverged,
        go,
        back,
        forward,
        close,
      });
  };

  const render = (activities: readonly PresenceActivity[], reason: PresenceFrame['reason']) => {
    if (lifetime.signal.aborted) return;
    // A frame that shows nothing new is skipped; a layout frame always confirms positions.
    const last = rendered;
    if (
      reason === 'activity' &&
      last !== undefined &&
      last.navigation === navigation &&
      last.activities.length === activities.length &&
      last.activities.every((activity, index) => activity === activities[index])
    )
      return;
    rendered = { activities, navigation };
    try {
      options.renderer?.render({ activities, reason, navigation });
    } catch (error) {
      report(error);
    }
  };
  const recordedTargets = createTargetTracker(
    targets,
    (target, reason) => {
      if (!recorded) return;
      recorded.activity = { ...recorded.activity, target };
      render([recorded.activity], reason);
    },
    report,
  );
  /** A recorded frame keeps its projection, and its target, while what it shows is unchanged. */
  const showRecorded = (
    activity: PresenceActivity,
    reason: PresenceFrame['reason'],
    places: readonly PresenceFocus[] = [],
  ) => {
    const same = recorded?.id === activity.recordId;
    if (!same) recordedTargets.cancel();
    const shown = { ...activity, target: same ? recorded!.activity.target : null };
    recorded = {
      id: activity.recordId!,
      activity: samePresenceActivity(recorded?.activity, shown) ? recorded!.activity : shown,
      places,
    };
    render([recorded.activity], reason);
    if (same) return;
    if (places.length) recordedTargets.track(places, reason, lifetime.signal);
    else recordedTargets.stop();
  };
  const leaveRecorded = () => {
    recordedTargets.stop();
    recorded = undefined;
  };

  const present = (reason: PresenceFrame['reason'] = 'activity') => {
    // A hidden trail still shows work in progress; finished live entries wait with the trail. A
    // dismissal made while reviewing keeps the reviewed step until the controller leaves review.
    const shownLive = hidden ? live.filter(active) : live;
    const trailHidden = hidden === 'superseded' ? !reviewing() : !!hidden && state?.phase !== 'reviewing';
    // Live work shows itself. Once nothing is active, the request takes over at once, so a finished
    // turn's conclusion appears as it ends rather than after its live entry lingers.
    if (trailHidden || (!reviewing() && shownLive.length && (shownLive.some(active) || !trail.frames.length))) {
      leaveRecorded();
      render(shownLive, reason);
      return;
    }
    const frame = trail.frames[frameIndex()];
    const actor = trail.actor;
    if (!frame || !actor) {
      leaveRecorded();
      render([], reason);
      return;
    }
    // Start and conclusion frames describe the whole request, so they point at no single target.
    if (frame.kind === 'conclusion') {
      const { conclusion } = frame;
      showRecorded(
        {
          actor: conclusion.actor,
          recordId: conclusion.id,
          phase: conclusion.outcome,
          frame: 'conclusion',
          summary: conclusion.message,
          target: null,
          freshness: 'unknown',
        },
        reason,
      );
      return;
    }
    if (frame.kind === 'start') {
      showRecorded(
        {
          actor,
          recordId: frame.checkpoint.id,
          phase: 'reviewing',
          frame: 'start',
          summary: trail.opening,
          target: null,
          freshness: 'unknown',
        },
        reason,
      );
      return;
    }
    const { checkpoint } = frame;
    const execution = checkpoint.record.kind === 'action' ? checkpoint.record.execution : undefined;
    const focus = provenanceFocus(checkpoint.record);
    const { graph } = checkpoint.observation;
    const places = stepPlaces(focus, execution?.intent?.affects, (ref) => {
      const sourceId = graph.ownership.nodes[ref];
      return sourceId ? { sourceId } : undefined;
    });
    showRecorded(
      {
        actor: provenanceActor(checkpoint.record),
        recordId: checkpoint.id,
        phase: reviewing() ? 'reviewing' : 'completed',
        subject: stepSubject(graph, execution, focus?.ref),
        frame: 'step',
        summary: execution
          ? (execution.narration ?? execution.title ?? checkpoint.record.message)
          : checkpoint.record.message,
        execution,
        target: null,
        freshness: 'unknown',
      },
      reason,
      places,
    );
  };
  const release = replay?.subscribe(() => {
    const next = replay.getState();
    if (next === state) return;
    const previous = state?.latest?.id;
    state = next;
    if (state.latest && state.latest.id !== previous) {
      // A person's change retires agent feedback; the runtime's own observations leave it in place.
      const actor = provenanceActor(state.latest.record);
      if (includes(actor)) hidden = undefined;
      else if (actor.kind !== 'system') hidden = 'superseded';
    }
    refresh();
    present();
  });
  refresh();
  // A new viewer shows the retained checkpoint without waiting for unrelated activity.
  if (state) present();
  return {
    update(activities: readonly PresenceActivity[], reason: PresenceFrame['reason'], activityEvent = false) {
      // New agent events supersede retained checkpoints; a dismissal lifts only when new work begins.
      if (activityEvent && (hidden === 'superseded' || activities.some(active))) hidden = undefined;
      live = activities;
      if (!replay) {
        if (activities.some(active)) answer = undefined;
        answer =
          activities.find((activity) => activity.phase === 'completed' && activity.summary && !activity.execution) ??
          answer;
      }
      refresh();
      present(reason);
    },
    /** Layout moved `sourceId`, or every source: a recorded step on it looks its target up again, and its lookup renders. */
    invalidate(sourceId?: string) {
      if (recorded?.places.some((place) => !sourceId || place.sourceId === sourceId))
        recordedTargets.track(recorded.places, 'layout', lifetime.signal);
    },
    dispose() {
      lifetime.abort();
      leaveRecorded();
      release?.();
    },
  };
}
