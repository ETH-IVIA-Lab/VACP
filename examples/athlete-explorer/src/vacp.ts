import { z } from 'zod';
import { createVacpActions, createVacpProvider, installVacp } from '@vacp/sdk';
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { createVegaLitePresentation } from '@vacp/adapter-vega-lite/presentation';
import { createVgplotProvider, type VgplotPlotLike } from '@vacp/adapter-vgplot';
import { createVgplotPresentation } from '@vacp/adapter-vgplot/presentation';
import { createBrowserPresence, createElementPresenceResolver } from '@vacp/presence-browser';
import { installVacpWebMcp } from '@vacp/transport-webmcp';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { exampleOptions } from '../../config';
import type { Cohort } from './model';
import type { Charts } from './charts';
import type { Dashboard } from './app';

export async function connectVacp(model: Cohort, charts: Charts, dashboard: Dashboard) {
  const appId = 'vacp-examples',
    viewId = 'athletes';
  const controls = 'vacp://vacp-examples/athletes/cohort';
  const sports = 'vacp://vacp-examples/athletes/sports';
  const sex = 'vacp://vacp-examples/athletes/sex';
  const bodyRef = 'vacp://vacp-examples/athletes/physique';
  const ageRef = 'vacp://vacp-examples/athletes/age';
  const sportsInput = z.object({ sports: z.array(z.enum(model.sports)).max(model.sports.length) });
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
    .params(z.object({ sex: z.enum(['all', 'female', 'male']) }))
    .focus(() => ({ ref: sex, interaction: { kind: 'activate' } }))
    .handle(({ sex }) => {
      model.setSex(sex);
      return model.summary();
    });
  const custom = createVacpProvider({
    source: { id: 'vacp-source://vacp-examples/athletes/cohort', type: 'cohort', title: 'Sport comparison' },
    actions: actions.registry,
    subscribe: model.subscribe,
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [
          { ref: controls, kind: 'View', layer: 'ViewLayer', title: 'Olympic athlete cohort' },
          { ref: sports, kind: 'Widget', layer: 'ConfigLayer', title: 'Sport', data: { options: model.sports } },
          {
            ref: sex,
            kind: 'Widget',
            layer: 'ConfigLayer',
            title: 'Sex',
            data: { options: ['all', 'female', 'male'] },
          },
        ],
        edges: [
          { from: controls, to: sports, kind: 'contains' },
          { from: controls, to: sex, kind: 'contains' },
          { from: sports, to: bodyRef, kind: 'filters' },
          { from: sports, to: ageRef, kind: 'filters' },
          { from: sex, to: bodyRef, kind: 'filters' },
          { from: sex, to: ageRef, kind: 'filters' },
          { from: `${bodyRef}/param/body`, to: controls, kind: 'filters' },
          { from: `${ageRef}/interactor/0`, to: controls, kind: 'filters' },
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
  const bodyOptions = { appId, viewId, vizId: 'physique', title: 'Height and weight', enableDuckDbDataHandle: false };
  const bodyArgs = { root: dashboard.body, view: charts.view, spec: charts.spec, options: bodyOptions };
  const body = createVegaLiteProvider(bodyArgs);
  const ageArgs = {
    root: dashboard.age,
    plots: [{ plotId: 'age', plot: charts.plot as VgplotPlotLike, element: charts.ageElement }],
    options: {
      appId,
      viewId,
      title: 'Age distribution',
      enableSql: exampleOptions.enableSql,
      duckdbClient: charts.data,
    },
  };
  const age = createVgplotProvider(ageArgs);
  const integration = installVacp({
    providers: [custom, body, age],
    sessionKey: 'athletes',
    exposeBridge: exampleOptions.exposeBridge,
    injectDomSnapshot: exampleOptions.injectDomSnapshot,
  });
  const presence = createBrowserPresence(integration.bridge);
  try {
    presence.attach(body, createVegaLitePresentation(bodyArgs));
    presence.attach(age, createVgplotPresentation(ageArgs));
    presence.attach(custom, {
      resolve: createElementPresenceResolver((focus) => {
        if (focus.ref === sex) return dashboard.sex;
        const input = sportsInput.safeParse(focus.detail);
        return input.success ? dashboard.target(input.data.sports[0]) : null;
      }),
    });
    if (exampleOptions.webmcp) await installVacpWebMcp(integration.bridge);
    return () => {
      presence.dispose();
      integration.dispose();
    };
  } catch (error) {
    presence.dispose();
    integration.dispose();
    throw error;
  }
}
