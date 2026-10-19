import { createSharedSubscription } from '@ethivia/vacp-runtime';
import type { VacpFreshness } from '@ethivia/vacp-protocol';
import type { VgplotInteractorLike, VgplotPlotLike } from './types';

const outputs = new WeakMap<VgplotPlotLike, VacpFreshness>();
const failures = new WeakMap<VgplotPlotLike, (error: unknown) => void>();

/** Completion is reported through render revisions, never inferred from update's promise. */
export function requestPlotUpdate(plot: VgplotPlotLike): void {
  const result = plot.update?.();
  const fail = failures.get(plot);
  const revision = outputs.get(plot)?.inputRevision;
  void Promise.resolve(result).catch((error: unknown) => {
    if (failures.get(plot) === fail && outputs.get(plot)?.inputRevision === revision) fail?.(error);
  });
}
export function plotFreshness(plot: VgplotPlotLike) {
  return outputs.get(plot);
}

type UpdateOwner = { update?: (...values: any[]) => unknown };
export const observeNativeUpdate = createSharedSubscription<UpdateOwner>((owner, invalidate) => {
  const original = owner.update;
  if (!original) return () => {};
  const wrapped = (...values: unknown[]) => {
    const result = original.apply(owner, values);
    invalidate();
    return result;
  };
  owner.update = wrapped;
  return () => {
    if (owner.update === wrapped) owner.update = original;
  };
});

export const observeNativeInteractor = createSharedSubscription<VgplotInteractorLike>((interactor, invalidate) => {
  let active = true;
  let selection = interactor.selection;
  let release = selection ? observeNativeUpdate(selection, invalidate) : undefined;
  const original = interactor.init;
  if (!original)
    return () => {
      active = false;
      release?.();
    };
  const updated = () => {
    if (!active) return;
    if (selection !== interactor.selection) {
      release?.();
      selection = interactor.selection;
      release = undefined;
      try {
        release = selection ? observeNativeUpdate(selection, invalidate) : undefined;
      } catch {
        // Late observation setup cannot turn a successful native initialization into a failure.
        // Initialization still invalidates the provider, whose live state remains readable.
      }
    }
    invalidate();
  };
  const wrapped = (svg: SVGElement) => {
    const result = original.call(interactor, svg);
    if (result instanceof Promise) void result.then(updated, updated);
    else updated();
    return result;
  };
  try {
    interactor.init = wrapped;
  } catch (error) {
    release?.();
    throw error;
  }
  return () => {
    active = false;
    release?.();
    if (interactor.init === wrapped) interactor.init = original;
  };
});

export const observeNativePlot = createSharedSubscription<VgplotPlotLike>((plot, invalidate) => {
  const pending = plot.pending,
    render = plot.render;
  if (!pending || !render) return () => {};
  let active = true;
  let revision = 0;
  outputs.delete(plot);
  const fail = (error: unknown) => {
    if (!active) return;
    outputs.set(plot, {
      status: 'error',
      inputRevision: String(revision),
      message: error instanceof Error ? error.message : String(error),
    });
    invalidate();
  };
  failures.set(plot, fail);
  const onPending = (...values: unknown[]) => {
    outputs.set(plot, { status: 'running', inputRevision: String(++revision) });
    invalidate();
    try {
      return pending.apply(plot, values);
    } catch (error) {
      fail(error);
      throw error;
    }
  };
  const onRender = (...values: unknown[]) => {
    const expected = revision;
    const current = () => {
      if (active && revision === expected) {
        outputs.set(plot, { status: 'current', inputRevision: String(expected), outputRevision: String(expected) });
        invalidate();
      }
    };
    const failed = (error: unknown) => {
      if (revision === expected) fail(error);
    };
    try {
      const result = render.apply(plot, values);
      if (result instanceof Promise) void result.then(current, failed);
      else current();
      return result;
    } catch (error) {
      failed(error);
      throw error;
    }
  };
  const detach = () => {
    active = false;
    if (plot.pending === onPending) plot.pending = pending;
    if (plot.render === onRender) plot.render = render;
    failures.delete(plot);
    outputs.delete(plot);
  };
  try {
    plot.pending = onPending;
    plot.render = onRender;
  } catch (error) {
    detach();
    throw error;
  }
  return detach;
});
