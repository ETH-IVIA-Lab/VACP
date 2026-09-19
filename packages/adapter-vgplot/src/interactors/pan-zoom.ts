import type { VacpInteraction } from '@vacp/protocol';
import { readScaleDomain } from './interval';
import type { VgplotInteractorLike } from '../types';

/** Validate both axes before applying either one. */
export function preparePanZoom(interactor: VgplotInteractorLike, params: Record<string, unknown> | null) {
  if (interactor.constructor.name !== 'PanZoom') throw new Error('Expected PanZoom interactor');
  const clause = interactor.clause;
  if (!clause) throw new Error('PanZoom interactor is missing clause');
  const mutations: Array<{ current(): boolean; apply(): void }> = [];
  const changes: number[] = [];
  for (const axis of ['x', 'y'] as const) {
    const a = params?.[`${axis}0`],
      b = params?.[`${axis}1`];
    if (params && a === undefined && b === undefined) continue;
    const value = params ? [Number(a), Number(b)] : null;
    if (value && !value.every(Number.isFinite)) throw new Error(`Expected numeric ${axis}0/${axis}1`);
    const selection = axis === 'x' ? interactor.xsel : interactor.ysel;
    const update = selection?.update;
    if (!update) throw new Error(`PanZoom interactor is missing ${axis}sel.update`);
    const field = axis === 'x' ? interactor.xfield : interactor.yfield;
    // PanZoom's xscale/yscale are gesture-start caches. Its SVG is refreshed on each render.
    let scale = axis === 'x' ? interactor.xscale : interactor.yscale;
    try {
      scale = interactor.svg?.scale(axis) ?? scale;
      if (value) {
        const domain = readScaleDomain(scale);
        const previous = domain && Math.abs(Number(domain.at(-1)) - Number(domain[0]));
        if (previous && Number.isFinite(previous)) changes.push(Math.abs(value[1]! - value[0]!) / previous);
      }
    } catch {
      // Optional presentation metadata must not reject an otherwise valid operation.
    }
    mutations.push({
      current: () => (axis === 'x' ? interactor.xsel : interactor.ysel) === selection,
      apply: () => {
        update.call(selection, clause.call(interactor, value, field, scale));
      },
    });
  }
  if (!mutations.length) throw new Error('Expected at least one axis domain');
  return {
    interaction: params ? panZoomInteraction(changes) : ({ kind: 'activate' } satisfies VacpInteraction),
    execute() {
      if (mutations.some((mutation) => !mutation.current())) throw new Error('Axis binding changed; prepare again');
      for (const mutation of mutations) mutation.apply();
      return params ? { set: true } : { cleared: true };
    },
  };
}

function panZoomInteraction(changes: number[]): VacpInteraction {
  const shrinking = changes.some((ratio) => ratio < 1 - 1e-6);
  const expanding = changes.some((ratio) => ratio > 1 + 1e-6);
  return shrinking || expanding
    ? { kind: 'zoom', direction: shrinking && !expanding ? 'in' : expanding && !shrinking ? 'out' : undefined }
    : { kind: 'pan' };
}
