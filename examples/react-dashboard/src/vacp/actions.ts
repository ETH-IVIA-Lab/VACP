import { z } from 'zod';
import { registerVacpApplyStateAction } from '@ethivia/vacp-runtime';
import type { VacpActions } from '@ethivia/vacp-sdk';
import { listDatasets } from '../datasets/registry';
import { numericValues, quantile, assertDashboardEncoding, assertDashboardSelection } from '../lib/dashboard';
import type { ReactDashboardModel } from './model';
import { dashboardRefs } from './refs';
import { prepareDashboardRestoration } from './restoration';

export function registerDashboardActions(actions: VacpActions, model: ReactDashboardModel) {
  const datasetIds = listDatasets().map(({ id }) => id);
  const { vizRef, scatterRef, selectionRef, brush2dRef, handleRef } = dashboardRefs;
  actions
    .operation(
      'mutation',
      'dashboard.set_dataset',
      `Set the active dataset (loads JSON rows and rebuilds the DuckDB table). Valid ids: ${datasetIds.join(', ')}.`,
    )
    .affects(handleRef)
    .params(z.object({ id: z.enum(datasetIds) }))
    .focus(() => ({ ref: handleRef, detail: { control: 'dataset' }, interaction: { kind: 'activate' } }))
    .handle(async (params) => {
      const { id } = params;
      await model.setDatasetId(id);

      return { datasetId: id };
    });

  actions
    .operation('mutation', 'dashboard.set_encoding', 'Set x/y/color encodings for the scatterplot.')
    .requires(handleRef)
    .affects(scatterRef)
    .params(
      z
        .object({ x: z.string().min(1), y: z.string().min(1), color: z.string().nullable().default(null) })
        .transform((params) => {
          assertDashboardEncoding(model.read().dataset, params);
          return params;
        }),
    )
    .focus(() => ({ ref: scatterRef, detail: { control: 'encoding' }, interaction: { kind: 'activate' } }))
    .handle((params) => {
      const { x, y, color } = params;
      assertDashboardEncoding(model.read().dataset, params);
      model.setEncoding({ x, y, color });

      return { ok: true };
    });

  actions
    .operation('mutation', 'dashboard.set_selected_ids', 'Set the selected row ids (replaces current selection).')
    .requires(scatterRef)
    .affects(selectionRef)
    .params(
      z.object({ ids: z.array(z.string()) }).transform((params) => {
        assertDashboardSelection(model.read().dataset, params.ids);
        return params;
      }),
    )
    .focus(({ ids }) => ({ ref: selectionRef, detail: { ids } }))
    .handle((params) => {
      assertDashboardSelection(model.read().dataset, params.ids);
      model.setSelectedIds(params.ids);

      return { selectedCount: model.read().selectedIds.length };
    });

  actions
    .operation(
      'mutation',
      'dashboard.set_brush_2d',
      'Set a 2D rectangular brush in data space (x/y) and replace the selection.',
    )
    .requires(scatterRef)
    .affects(brush2dRef)
    .params(z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() }))
    .focus(() => ({ ref: brush2dRef, interaction: { kind: 'brush' } }))
    .handle((params) => {
      const { x0, x1, y0, y1 } = params;
      model.setBrush2d({ x0, x1, y0, y1 });

      return { brush2d: model.read().brush2d, selectedCount: model.read().selectedIds.length };
    });

  actions
    .operation(
      'mutation',
      'dashboard.select_by_quantiles',
      'Select points within x/y quantile bounds of the current encoding for compact subset selection without hand-picking raw ranges.',
    )
    .requires(scatterRef)
    .affects(selectionRef)
    .params(
      z
        .object({
          xMinQ: z.number().min(0).max(1).default(0),
          xMaxQ: z.number().min(0).max(1).default(0.35),
          yMinQ: z.number().min(0).max(1).default(0),
          yMaxQ: z.number().min(0).max(1).default(0.35),
        })
        .default({ xMinQ: 0, xMaxQ: 0.35, yMinQ: 0, yMaxQ: 0.35 }),
    )
    .focus(() => ({ ref: brush2dRef, interaction: { kind: 'brush' } }))
    .handle((params) => {
      const { dataset, encoding } = model.read();

      if (!dataset) throw new Error('No dataset loaded');

      if (!encoding.x || !encoding.y) throw new Error('Set x and y encoding before quantile selection');

      const { xMinQ, xMaxQ, yMinQ, yMaxQ } = params;

      const xVals = numericValues(dataset, encoding.x);
      const yVals = numericValues(dataset, encoding.y);

      if (!xVals.length || !yVals.length) throw new Error('Current encoding fields are not numeric');

      const x0 = quantile(xVals, Math.min(xMinQ, xMaxQ));
      const x1 = quantile(xVals, Math.max(xMinQ, xMaxQ));
      const y0 = quantile(yVals, Math.min(yMinQ, yMaxQ));
      const y1 = quantile(yVals, Math.max(yMinQ, yMaxQ));
      model.setBrush2d({ x0, x1, y0, y1 });

      return {
        brush2d: model.read().brush2d,
        selectedCount: model.read().selectedIds.length,
        quantiles: { xMinQ, xMaxQ, yMinQ, yMaxQ },
      };
    });

  actions
    .operation('mutation', 'dashboard.clear_brush_2d', 'Clear the 2D brush and clear the selection.')
    .requires(brush2dRef)
    .affects(brush2dRef)
    .params(z.object({}).default({}))
    .focus(() => ({ ref: brush2dRef }))
    .handle(() => {
      model.clearBrush2d();

      return { ok: true };
    });

  actions
    .operation('mutation', 'dashboard.toggle_selected_id', 'Toggle one row id in the selection.')
    .requires(scatterRef)
    .affects(selectionRef)
    .params(
      z.object({ id: z.string().min(1) }).transform((params) => {
        assertDashboardSelection(model.read().dataset, [params.id]);
        return params;
      }),
    )
    .focus(({ id }) => ({ ref: selectionRef, detail: { ids: [id] }, interaction: { kind: 'activate' } }))
    .handle((params) => {
      const { id } = params;
      assertDashboardSelection(model.read().dataset, [id]);
      model.toggleSelectedId(id);

      return { selectedCount: model.read().selectedIds.length };
    });

  actions
    .operation('mutation', 'dashboard.clear_selection', 'Clear the explicit point selection.')
    .requires(selectionRef)
    .affects(selectionRef)
    .params(z.object({}).default({}))
    .focus(() => ({ ref: selectionRef }))
    .handle(() => {
      model.clearSelection();

      return { ok: true };
    });

  // Restoration reaches every recorded state, including the empty dashboard before a dataset loads.
  registerVacpApplyStateAction(actions.registry, (state) => prepareDashboardRestoration(model, state), {
    affects: [vizRef],
    description: 'Apply dashboard state (dataset/encoding/selection).',
  });
}
