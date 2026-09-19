import embed from 'vega-embed';
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { createVegaLitePresentation } from '@vacp/adapter-vega-lite/presentation';
import { createVacpRuntime } from '@vacp/runtime';
import {
  createBrowserPresence,
  createBrowserPresenceRenderer,
  type BrowserPresenceOptions,
} from '@vacp/presence-browser';

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

/** Real SVG rendering in an isolated document, with deterministic presentation time. */
function cursorFixture() {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:0;top:0;width:1000px;height:600px;border:0';
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const view = frame.contentWindow!;
  let now = 0,
    nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  view.performance.now = () => now;
  view.requestAnimationFrame = (callback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  };
  view.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  const tick = (time: number) => {
    now = time;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(now);
  };
  const render = (
    renderer: ReturnType<typeof createBrowserPresenceRenderer>,
    id: string,
    x: number | null,
    kind?: string,
    phase: 'prepared' | 'succeeded' = 'prepared',
  ) => {
    renderer.render([
      {
        execution: {
          id,
          callId: id,
          sequence: 1,
          name: 'demo',
          at: '',
          phase,
          actor: { id: 'agent', kind: 'agent' },
          intent: { affects: [], focus: { ref: 'vacp://target', interaction: kind ? { kind } : undefined } },
        },
        target:
          x === null
            ? null
            : { surface: 'viewport', precision: 'exact', geometry: { kind: 'point', point: { x, y: 100 } } },
        freshness: 'current',
      },
    ]);
  };
  const read = () => {
    const shadow = doc.querySelector('[data-vacp-presence]')!.shadowRoot!;
    const glyph = shadow.querySelector<SVGGElement>('[data-vacp-cursor]')!;
    const scale = shadow.querySelector<SVGGElement>('[data-vacp-travel]')!.transform.baseVal.consolidate()!.matrix.a;
    return {
      shape: glyph.dataset.vacpCursorShape,
      scale,
      path: glyph.querySelector('path')!.getAttribute('d'),
      ripple: !!shadow.querySelector('[data-vacp-ripple]'),
    };
  };
  const renderers: ReturnType<typeof createBrowserPresenceRenderer>[] = [];
  return {
    doc,
    tick,
    render,
    read,
    create(options: BrowserPresenceOptions = {}) {
      const renderer = createBrowserPresenceRenderer({ ...options, document: doc });
      renderers.push(renderer);
      return renderer;
    },
    dispose() {
      for (const renderer of renderers) renderer.dispose?.();
      frame.remove();
    },
  };
}

export function measureCursorMotion() {
  const fixture = cursorFixture();
  const { doc, tick, render, read } = fixture;
  const renderer = fixture.create({ motion: 'full', durationMs: 400 });
  try {
    render(renderer, 'initial', 100);
    render(renderer, 'brush', 700, 'brush');
    tick(200);
    const middle = read();
    render(renderer, 'interrupted', 400, 'brush');
    const interruption = read();
    tick(600);
    const settled = read();
    const glyph = doc
      .querySelector('[data-vacp-presence]')!
      .shadowRoot!.querySelector<SVGPathElement>('[data-vacp-cursor] path')!;
    const hotspot = new DOMPoint(12, 12).matrixTransform(glyph.getScreenCTM()!);
    render(renderer, 'resume', 900, 'brush');
    tick(800);
    render(renderer, 'resume', null, 'brush');
    render(renderer, 'resume', 900, 'brush');
    tick(1200);
    const recovered = new DOMPoint(12, 12).matrixTransform(glyph.getScreenCTM()!);
    renderer.dispose?.();
    const reduced = fixture.create({ motion: 'reduced' });
    render(reduced, 'start', 100);
    render(reduced, 'end', 700, 'brush');
    return {
      middle,
      interruption,
      settled,
      still: read(),
      hotspot: { x: hotspot.x, y: hotspot.y },
      recovered: { x: recovered.x, y: recovered.y },
    };
  } finally {
    fixture.dispose();
  }
}

export function measureCursorAppearance() {
  const fixture = cursorFixture();
  const { doc, tick, render, read } = fixture;
  try {
    const defaults = fixture.create();
    render(defaults, 'initial', 400);
    const initial = read();
    render(defaults, 'drag', 400, 'drag', 'succeeded');
    const pressed = read();
    render(defaults, 'hover', 400, 'point', 'succeeded');
    const hover = read();
    defaults.dispose?.();
    let invalidAssetsRejected = false;
    try {
      fixture.create({ cursor: { assets: { bad: { path: 'M0 0', hotspot: { x: NaN, y: 0 } } } } });
    } catch {
      invalidAssetsRejected = doc.querySelector('[data-vacp-presence]') === null;
    }
    const custom = fixture.create({
      motion: 'full',
      durationMs: 400,
      travel: false,
      cursor: {
        resolve: (activity) => ({
          shape: activity.execution.intent?.focus?.interaction ? 'app-target' : 'toString',
          feedback: false,
        }),
        assets: {
          'app-target': { path: 'M0 0h24v24H0Z', hotspot: { x: 12, y: 12 }, fill: 'red' },
          arrow: { path: 'M0 0h10v10H0Z', hotspot: { x: 0, y: 0 } },
        },
      },
    });
    render(custom, 'custom-start', 100, 'lasso');
    render(custom, 'custom-end', 700, 'lasso', 'succeeded');
    tick(200);
    const overridden = read();
    tick(400);
    const feedback = read();
    render(custom, 'fallback', 700);
    const fallback = read();
    custom.dispose?.();
    return {
      initial,
      pressed,
      hover,
      overridden,
      feedback,
      fallback,
      invalidAssetsRejected,
      remaining: doc.querySelectorAll('[data-vacp-presence]').length,
    };
  } finally {
    fixture.dispose();
  }
}
