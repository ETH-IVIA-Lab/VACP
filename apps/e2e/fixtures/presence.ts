import embed from 'vega-embed';
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { createVegaLitePresentation } from '@vacp/adapter-vega-lite/presentation';
import { createVacpRuntime } from '@vacp/runtime';
import { createBrowserPresence } from '@vacp/presence-browser';

/** Exercise real Vega rendering with explicit padding and CSS scaling. */
export async function mountPresenceChart(
  root: HTMLElement,
  renderer: 'svg' | 'canvas',
  presenceOptions: Parameters<typeof createBrowserPresence>[1] = {},
) {
  const spec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    width: 400,
    height: 200,
    padding: { left: 21, right: 9, top: 17, bottom: 11 },
    data: {
      values: [
        { x: 0, y: 0 },
        { x: 5, y: 4 },
        { x: 10, y: 8 },
      ],
    },
    params: [{ name: 'brush', select: { type: 'interval' as const, encodings: ['x' as const] } }],
    mark: 'point' as const,
    encoding: { x: { field: 'x', type: 'quantitative' as const }, y: { field: 'y', type: 'quantitative' as const } },
  };
  const result = await embed(root, spec, { actions: false, renderer });
  const config = {
    root,
    view: result.view,
    spec,
    options: { appId: 'presence-test', viewId: renderer, vizId: 'chart', enableDuckDbDataHandle: false },
  };
  const provider = createVegaLiteProvider(config);
  const runtime = createVacpRuntime({ providers: [provider] });
  const presence = createBrowserPresence(runtime, {
    lingerMs: 30_000,
    appearance: { motion: 'reduced' },
    ...presenceOptions,
  });
  presence.attach(provider, createVegaLitePresentation(config));
  const graph = (await runtime.getCapabilities()).graph;
  const action = graph.actions.find((action) => action.operation.contract === 'vega_lite.set_selection')!;
  const ref = graph.nodes.find((node) => node.ref.endsWith('/param/brush'))!.ref;
  return {
    async filter() {
      return runtime.execute({ callId: 'brush', name: action.name, params: { ref, value: { x: [2, 6] } } });
    },
    dispose() {
      presence.dispose();
      runtime.dispose();
      result.finalize();
    },
  };
}
