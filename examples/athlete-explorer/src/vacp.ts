import { z } from 'zod';
import { vacpHumanActor, type VacpNodeKind, type VacpProvider } from '@vacp/protocol';
import { createVacpProvider, registerVacpApplyStateAction } from '@vacp/runtime';
import { createVacpActions, createVacpRefBuilder } from '@vacp/sdk';
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { createVegaLitePresentation } from '@vacp/adapter-vega-lite/presentation';
import { createVgplotProvider } from '@vacp/adapter-vgplot';
import { createVgplotPresentation } from '@vacp/adapter-vgplot/presentation';
import { countDuckDbTablesOnce } from '@vacp/data-duckdb';
import { installExampleRuntime } from '@vacp/example-shared';
import { exampleOptions } from '@vacp/example-shared/config';
import { createElementPresenceResolver, observePresenceLayout } from '@vacp/presence-core/dom';
import type { Cohort } from './model';
import type { Charts } from './charts';
import type { Dashboard } from './app';

/** The ref of the one node of `kind` that `provider` publishes. */
async function nodeRef(provider: VacpProvider, kind: VacpNodeKind) {
  const { graph } = await provider.observe();
  const [node, ...others] = graph.nodes.filter((candidate) => candidate.kind === kind);
  if (!node || others.length) throw new Error(`Expected one ${kind} node from ${provider.source.id}`);
  return node.ref;
}

export async function connectVacp(args: {
  model: Cohort;
  charts: Charts;
  dashboard: Dashboard;
  root: HTMLElement;
  signal: AbortSignal;
}): Promise<void> {
  const { model, charts, dashboard, root, signal } = args;
  const appId = 'vacp-examples';
  const viewId = 'athletes';
  const body = createVegaLiteProvider({
    root: dashboard.body,
    view: charts.view,
    spec: charts.spec,
    vgSpec: charts.vgSpec,
    options: { appId, viewId, vizId: 'physique', title: 'Height and weight' },
  });
  const age = createVgplotProvider({
    root: dashboard.age,
    plots: [{ plotId: 'age', plot: charts.plot }],
    data: { duckdb: charts.data, sql: exampleOptions.enableSql, describe: countDuckDbTablesOnce(charts.data) },
    options: { appId, viewId, title: 'Age distribution' },
  });
  const [bodyView, bodyBrush, ageView, ageBrush] = await Promise.all([
    nodeRef(body, 'Visualization'),
    nodeRef(body, 'Selection'),
    nodeRef(age, 'Visualization'),
    nodeRef(age, 'InteractionTarget'),
  ]);

  const refs = createVacpRefBuilder({ appId, viewId });
  const controls = refs.ref('cohort');
  const sports = refs.ref('sports');
  const sex = refs.ref('sex');
  const sportsInput = z.object({ sports: z.array(z.enum(model.sports)).max(model.sports.length) });
  const sexValue = z.enum(['all', 'female', 'male']);
  const actions = createVacpActions();
  actions
    .operation(
      'mutation',
      'cohort.set_sports',
      'Select a set of sports, or use an empty array for all sports. Preserve age, body and sex filters.',
    )
    .title('Select sports')
    .affects(sports)
    .params(sportsInput)
    .focus(({ sports: selected }) => ({ ref: sports, detail: { sports: selected }, interaction: { kind: 'activate' } }))
    .handle(({ sports }) => {
      model.setSports(sports);
      return model.summary();
    });
  actions
    .operation('mutation', 'cohort.set_sex', 'Select female, male, or all athletes. Preserve the other cohort filters.')
    .title('Select sex')
    .affects(sex)
    .params(z.object({ sex: sexValue }))
    .focus(() => ({ ref: sex, interaction: { kind: 'activate' } }))
    .handle(({ sex }) => {
      model.setSex(sex);
      return model.summary();
    });
  registerVacpApplyStateAction(actions.registry, (state) => {
    const selected =
      state[sports] === undefined
        ? undefined
        : z.object({ value: sportsInput.shape.sports }).parse(state[sports]).value;
    const selectedSex = state[sex] === undefined ? undefined : z.object({ value: sexValue }).parse(state[sex]).value;
    const owned = new Set<string>([controls, sports, sex]);
    for (const ref of Object.keys(state)) if (!owned.has(ref)) throw new Error(`Unknown cohort state: ${ref}`);
    return () => {
      if (selected !== undefined) model.setSports(selected);
      if (selectedSex !== undefined) model.setSex(selectedSex);
      return {
        applied: [selected !== undefined ? sports : null, selectedSex !== undefined ? sex : null].filter(Boolean),
        skipped: state[controls] === undefined ? [] : [controls],
      };
    };
  });
  const cohort = createVacpProvider({
    source: { id: 'vacp-source://vacp-examples/athletes/cohort', type: 'cohort', title: 'Sport comparison' },
    actions: actions.registry,
    subscribe: (invalidate) => model.subscribe(invalidate),
    project: () => ({
      graph: {
        nodes: [
          { ref: controls, kind: 'View', layer: 'ViewLayer', title: 'Olympic athlete cohort' },
          { ref: sports, kind: 'Widget', layer: 'ConfigLayer', title: 'Sport', data: { options: model.sports } },
          { ref: sex, kind: 'Widget', layer: 'ConfigLayer', title: 'Sex', data: { options: sexValue.options } },
        ],
        edges: [
          { from: controls, to: sports, kind: 'contains' },
          { from: controls, to: sex, kind: 'contains' },
          { from: sports, to: bodyView, kind: 'filters' },
          { from: sports, to: ageView, kind: 'filters' },
          { from: sex, to: bodyView, kind: 'filters' },
          { from: sex, to: ageView, kind: 'filters' },
          { from: bodyBrush, to: controls, kind: 'filters' },
          { from: ageBrush, to: controls, kind: 'filters' },
        ],
        actions: actions.registry.list(),
      },
      state: {
        [controls]: { ...model.filters, ...model.summary() },
        [sports]: { value: model.filters.sports, ranking: model.ranking() },
        [sex]: { value: model.filters.sex },
      },
    }),
  });

  const runtime = await installExampleRuntime({
    sources: [
      {
        provider: cohort,
        presentation: {
          subscribe: (invalidate) => observePresenceLayout(root, invalidate),
          resolve: createElementPresenceResolver((focus) => {
            if (focus.ref === sex) return dashboard.sex;
            const input = sportsInput.safeParse(focus.detail);
            return input.success ? dashboard.target(input.data.sports[0]) : null;
          }),
        },
      },
      { provider: body, presentation: createVegaLitePresentation({ provider: body, root: dashboard.body }) },
      { provider: age, presentation: createVgplotPresentation({ provider: age, root: dashboard.age }) },
    ],
    root,
    sessionKey: 'athletes',
    analytics: { vacp_app_id: appId, vacp_view_id: viewId },
    signal,
  });
  await runtime.refresh({ actor: { id: 'system', kind: 'system' }, message: 'Initial athlete view' });
  signal.throwIfAborted();
  const releaseHuman = dashboard.subscribeInteractions((control) => {
    const message =
      control === 'sex'
        ? `Selected ${model.filters.sex === 'all' ? 'all' : model.filters.sex} athletes`
        : model.filters.sports.length
          ? `Selected ${model.filters.sports.join(' and ')}`
          : 'Selected all sports';
    void runtime
      .refresh({
        actor: vacpHumanActor,
        message,
        focus: { ref: control === 'sex' ? sex : sports, detail: { sports: [...model.filters.sports] } },
      })
      .catch(() => {});
  });
  signal.addEventListener('abort', releaseHuman, { once: true });
}
