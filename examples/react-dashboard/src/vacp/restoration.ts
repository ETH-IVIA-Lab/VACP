import { z } from 'zod';
import type { VacpActionExecutionOptions, VacpRef } from '@ethivia/vacp-protocol';
import { listDatasets, loadDataset, type Encoding } from '../datasets/registry';
import { assertDashboardEncoding, assertDashboardSelection } from '../lib/dashboard';
import type { ReactDashboardModel } from './model';
import { dashboardRefs } from './refs';

const encodingState = z.object({
  datasetId: z
    .enum(listDatasets().map(({ id }) => id))
    .nullable()
    .optional(),
  x: z.string().nullable().optional(),
  y: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
});
const selectionState = z.object({ value: z.array(z.string()) });
const brushState = z.union([
  z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() }),
  z.object({ x0: z.null(), x1: z.null(), y0: z.null(), y1: z.null() }).transform(() => null),
]);

/** Prepare the dashboard's own snapshot shape; no native state changes during validation. */
export async function prepareDashboardRestoration(model: ReactDashboardModel, state: Record<VacpRef, unknown>) {
  const { scatterRef, selectionRef, brush2dRef } = dashboardRefs;
  const before = model.read();
  const scatter = state[scatterRef] === undefined ? undefined : encodingState.parse(state[scatterRef]);
  const selected = state[selectionRef] === undefined ? undefined : selectionState.parse(state[selectionRef]).value;
  const brush = state[brush2dRef] === undefined ? undefined : brushState.parse(state[brush2dRef]);
  const datasetId = scatter?.datasetId === undefined ? before.datasetId : scatter.datasetId;
  const dataset =
    datasetId === before.datasetId ? before.dataset : datasetId === null ? null : await loadDataset(datasetId);
  const patch: Partial<Encoding> = {};
  if (scatter?.x !== undefined) patch.x = scatter.x;
  if (scatter?.y !== undefined) patch.y = scatter.y;
  if (scatter?.color !== undefined) patch.color = scatter.color;
  const encoding = {
    ...(scatter?.datasetId === undefined
      ? before.encoding
      : (dataset?.defaultEncoding ?? { x: null, y: null, color: null })),
    ...patch,
  };
  assertDashboardEncoding(dataset, encoding);
  if (selected) assertDashboardSelection(dataset, selected);
  if (brush && (!encoding.x || !encoding.y)) throw new Error('A brush requires both axes');
  const hasPatch = Object.keys(patch).length > 0;
  const applied =
    Number(scatter?.datasetId !== undefined) +
    Number(hasPatch) +
    Number(selected !== undefined) +
    Number(brush !== undefined);

  return async ({ signal }: VacpActionExecutionOptions) => {
    signal?.throwIfAborted();
    if (model.read().datasetId !== before.datasetId) throw new Error('Dataset changed during restoration preparation');
    if (scatter?.datasetId !== undefined) await model.setDatasetId(scatter.datasetId);
    signal?.throwIfAborted();
    const current = model.read();
    if (current.datasetId !== datasetId) throw new Error('Dataset changed during restoration');
    assertDashboardEncoding(current.dataset, encoding);
    if (selected) assertDashboardSelection(current.dataset, selected);
    if (hasPatch) model.setEncoding(patch);
    // Clearing a saved absent brush must not erase an explicit saved point selection.
    if (brush === null) model.clearBrush2d();
    if (selected !== undefined) model.setSelectedIds(selected);
    if (brush) model.setBrush2d(brush);
    return { applied };
  };
}
