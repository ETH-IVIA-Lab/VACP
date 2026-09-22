import embed from 'vega-embed';
import { changeset } from 'vega';
import type { TopLevelSpec } from 'vega-lite';
import { Coordinator, DuckDBWASMConnector, Selection } from '@uwdata/mosaic-core';
import { and, eq, isBetween, literal, or } from '@uwdata/mosaic-sql';
import { createAPIContext } from '@uwdata/vgplot';
import { createDuckDbWasmClient } from '@vacp/data-duckdb';
import { z } from 'zod';
import type { Cohort } from './model';

const bodyValue = z.object({ weight: z.tuple([z.number(), z.number()]), height: z.tuple([z.number(), z.number()]) });
const ageValue = z.tuple([z.number(), z.number()]);

export async function createCharts(
  bodyRoot: HTMLElement,
  ageRoot: HTMLElement,
  model: Cohort,
  onError: (error: unknown) => void,
) {
  const connector = new DuckDBWASMConnector();
  const database = await connector.getDuckDB();
  const connection = await connector.getConnection();
  const data = await createDuckDbWasmClient({ duckdb: database, connection });
  const coordinator = new Coordinator(connector);
  let release = () => {};
  let finalize = () => {};
  let stopped = false;
  let pending = Promise.resolve();
  const dispose = async () => {
    if (stopped) return;
    stopped = true;
    release();
    await pending.catch(() => {});
    finalize();
    coordinator.clear();
    await data.dispose();
    await connection.close();
    await database.terminate();
  };
  try {
    await data.loadObjectsAsTable(
      'athletes',
      model.athletes.map((row) => ({ ...row })),
    );
    const spec: TopLevelSpec = {
      width: 'container',
      height: 310,
      data: { name: 'athletes', values: model.athletes },
      mark: { type: 'point', filled: true, size: 16, clip: true },
      params: [{ name: 'body', select: { type: 'interval', encodings: ['x', 'y'] } }],
      encoding: {
        x: { field: 'weight', type: 'quantitative', title: 'Weight (kg)', scale: { domain: [30, 170] } },
        y: { field: 'height', type: 'quantitative', title: 'Height (m)', scale: { domain: [1.2, 2.25] } },
        color: {
          field: 'sex',
          type: 'nominal',
          scale: { domain: ['female', 'male'], range: ['#0070f3', '#9b76c8'] },
          legend: { orient: 'bottom', title: null },
        },
        opacity: { condition: { param: 'body', value: 0.35 }, value: 0.04 },
        tooltip: [
          { field: 'name' },
          { field: 'sport' },
          { field: 'nationality' },
          { field: 'age' },
          { field: 'height' },
          { field: 'weight' },
        ],
      },
      config: {
        background: 'transparent',
        view: { stroke: null },
        axis: {
          gridColor: '#eee',
          domain: false,
          ticks: false,
          labelColor: '#666',
          titleFontWeight: 'normal',
          titleColor: '#666',
          labelPadding: 8,
          titlePadding: 12,
        },
      },
    };
    const embedded = await embed(bodyRoot, spec, { actions: false, renderer: 'canvas' });
    finalize = embedded.finalize;
    const vg = createAPIContext({ coordinator });
    const selection = Selection.crossfilter();
    const ageElement = vg.plot(
      vg.rectY(vg.from('athletes', { filterBy: selection }), {
        x: vg.bin('age', { step: 1 }),
        y: vg.count(),
        fill: '#0070f3',
        inset: 0.5,
      }),
      vg.intervalX({ as: selection }),
      vg.width(Math.max(260, ageRoot.clientWidth)),
      vg.height(210),
      vg.xDomain([10, 70]),
      vg.yDomain(vg.Fixed),
      vg.xLabel('Age at Rio 2016'),
      vg.yLabel('Athletes'),
      vg.style({ background: 'transparent', color: '#666', fontFamily: 'inherit' }),
    );
    ageRoot.append(ageElement);
    const plot = ageElement.value;
    await Promise.all(plot.marks.map((mark: { pending: Promise<unknown> }) => mark.pending));
    await plot.update();
    const ageInteractor = plot.interactors[0];
    if (!ageInteractor) throw new Error('Age brush did not initialize');
    const onAge = () => {
      const parsed = ageValue.safeParse(selection.valueFor(ageInteractor));
      model.setAge(parsed.success ? parsed.data : null);
    };
    const onBody = (_: string, value: unknown) => {
      const parsed = bodyValue.safeParse(value);
      model.setBody(parsed.success ? parsed.data : null);
    };
    selection.addEventListener('value', onAge);
    embedded.view.addSignalListener('body', onBody);
    const external = {};
    let filterKey = '',
      scatterKey = '';
    const sync = () => {
      const { sports, sex, body, age } = model.filters;
      const key = JSON.stringify([sports, sex, body]);
      if (key !== filterKey) {
        filterKey = key;
        const terms = [
          sports.length ? or(sports.map((sport) => eq('sport', literal(sport)))) : null,
          sex !== 'all' ? eq('sex', literal(sex)) : null,
          body ? isBetween('weight', body.weight) : null,
          body ? isBetween('height', body.height) : null,
        ].filter((term) => term !== null);
        selection.update({
          source: external,
          value: { sports, sex, body },
          predicate: terms.length ? and(terms) : null,
        });
      }
      const nextScatter = JSON.stringify([sports, sex, age]);
      if (nextScatter === scatterKey) return;
      scatterKey = nextScatter;
      const rows = model.rows('body');
      pending = pending
        .then(async () => {
          if (stopped || scatterKey !== nextScatter) return;
          embedded.view.change(
            'athletes',
            changeset()
              .remove(() => true)
              .insert(rows),
          );
          await embedded.view.runAsync();
        })
        .catch(onError);
    };
    const unsubscribe = model.subscribe(sync);
    const resize = new ResizeObserver(() => {
      if (!stopped && plot.setAttribute('width', Math.max(260, ageRoot.clientWidth)))
        void Promise.resolve(plot.update()).catch(onError);
    });
    resize.observe(ageRoot);
    release = () => {
      resize.disconnect();
      unsubscribe();
      selection.removeEventListener('value', onAge);
      embedded.view.removeSignalListener('body', onBody);
    };
    sync();
    return { view: embedded.view, spec, plot, ageElement, data, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
export type Charts = Awaited<ReturnType<typeof createCharts>>;
