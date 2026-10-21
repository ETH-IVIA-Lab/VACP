import embed from 'vega-embed';
import { createVegaLiteProvider } from '@ethivia/vacp-vega-lite';
import { createVegaLitePresentation } from '@ethivia/vacp-vega-lite/presentation';
import { vacpAgentActor } from '@ethivia/vacp-protocol';
import { createVacpRuntime } from '@ethivia/vacp-runtime';
import {
  createBrowserPresence,
  createBrowserPresenceRenderer,
  type BrowserPresenceOptions,
} from '@ethivia/vacp-presence-react';

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
    vgSpec: result.vgSpec,
    spec,
    options: { appId: 'presence-test', viewId: renderer, vizId: 'chart' },
  };
  const provider = createVegaLiteProvider(config);
  const runtime = createVacpRuntime({ providers: [provider] });
  const presence = createBrowserPresence(runtime, {
    lingerMs: 30_000,
    appearance: { motion: 'reduced' },
    ...presenceOptions,
  });
  presence.attach(provider, createVegaLitePresentation({ provider, root: config.root }));
  const graph = (await runtime.getCapabilities()).graph;
  const action = graph.actions.find((action) => action.operation.contract === 'vega_lite.set_selection')!;
  const ref = graph.nodes.find((node) => node.ref.endsWith('/param/brush'))!.ref;
  return {
    /** One finished agent request: a brush, then the closing sentence. */
    async filter() {
      const result = await runtime.execute({
        callId: 'brush',
        name: action.name,
        params: { ref, value: { x: [2, 6] } },
      });
      runtime.narrate({ actor: { id: 'agent', kind: 'agent' }, message: 'The brushed range is selected.', done: true });
      return result;
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
    renderer.render({
      reason: 'activity',
      activities: [
        {
          actor: { id: 'agent', kind: 'agent' },
          phase: phase === 'prepared' ? 'acting' : 'completed',
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
      ],
    });
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
    tick(1000);
    const settled = read();
    const glyph = doc
      .querySelector('[data-vacp-presence]')!
      .shadowRoot!.querySelector<SVGPathElement>('[data-vacp-cursor] path')!;
    const hotspot = new DOMPoint(12, 12).matrixTransform(glyph.getScreenCTM()!);
    render(renderer, 'resume', 900, 'brush');
    tick(1200);
    render(renderer, 'resume', null, 'brush');
    render(renderer, 'resume', 900, 'brush');
    tick(2000);
    const recovered = new DOMPoint(12, 12).matrixTransform(glyph.getScreenCTM()!);
    render(renderer, 'next', 600, 'brush');
    tick(2050);
    render(renderer, 'read', null);
    tick(3000);
    const pointer = doc
      .querySelector('[data-vacp-presence]')!
      .shadowRoot!.querySelector<SVGGElement>('g[data-vacp-phase]')!;
    const afterRead = new DOMPoint(0, 0).matrixTransform(pointer.getScreenCTM()!);
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
      afterRead: { x: afterRead.x, y: afterRead.y },
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
          shape: activity.execution?.intent?.focus?.interaction ? 'app-target' : 'toString',
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

/** Check the rendered overlay against independent target rectangles, including during motion. */
export async function measureBubblePlacement() {
  const renderer = createBrowserPresenceRenderer({ motion: 'full', hover: false });
  const host = [...document.querySelectorAll('[data-vacp-presence]')].at(-1)!.shadowRoot!;
  const actor = { id: 'bubble-test', kind: 'agent' as const, label: 'Analyst' };
  const rectangles = [
    { x: 400, y: 300, width: 300, height: 240 },
    { x: innerWidth - 200, y: 20, width: 160, height: 160 },
    { x: 20, y: innerHeight - 200, width: 300, height: 160 },
    { x: 20, y: 20, width: innerWidth - 40, height: 120 },
  ];
  const samples: Array<{ clear: boolean; withinViewport: boolean }> = [];
  const render = (summary: string, rect = rectangles[0]!, phase: 'thinking' | 'acting' = 'thinking') =>
    renderer.render({
      reason: 'activity',
      activities: [
        {
          actor,
          phase,
          summary,
          freshness: 'unknown',
          target: { surface: 'viewport', precision: 'exact', geometry: { kind: 'region', ...rect } },
        },
      ],
    });
  try {
    for (const rect of rectangles) {
      render('Comparing these athletes', rect);
      const until = performance.now() + 360;
      do {
        await new Promise(requestAnimationFrame);
        const label = host.querySelector<HTMLElement>('[data-vacp-bubble]')!.getBoundingClientRect();
        samples.push({
          clear:
            label.right <= rect.x ||
            label.left >= rect.x + rect.width ||
            label.bottom <= rect.y ||
            label.top >= rect.y + rect.height,
          withinViewport: label.left >= 0 && label.top >= 0 && label.right <= innerWidth && label.bottom <= innerHeight,
        });
      } while (performance.now() < until);
    }
    const label = host.querySelector<HTMLElement>('[data-vacp-bubble]')!;
    const summary = label.querySelector('[data-vacp-summary]')!;
    const changes: string[] = [];
    const observer = new MutationObserver(() => changes.push(summary.textContent!));
    observer.observe(summary, { childList: true, subtree: true, characterData: true });
    render('Narrowing the height range');
    await new Promise(requestAnimationFrame);
    render('Narrowing the height range', rectangles[0], 'acting');
    await new Promise(requestAnimationFrame);
    render('Narrowing the height');
    await new Promise(requestAnimationFrame);
    render('NARROWING the height');
    await new Promise(requestAnimationFrame);
    observer.disconnect();
    return {
      samples,
      changes,
      displayed: summary.textContent,
      announced: host.querySelector('[role="status"]')!.textContent,
    };
  } finally {
    renderer.dispose?.();
  }
}

export function measureGrowingTrailFocus() {
  const renderer = createBrowserPresenceRenderer({ motion: 'reduced', hover: false });
  const shadow = [...document.querySelectorAll('[data-vacp-presence]')].at(-1)!.shadowRoot!;
  const render = (frames: import('@ethivia/vacp-presence').PresenceTrailFrame[]) =>
    renderer.render({
      reason: 'activity',
      activities: [
        {
          actor: { id: 'agent', kind: 'agent' },
          phase: 'completed',
          recordId: 'step',
          summary: 'Filtering rows',
          target: null,
          freshness: 'current',
        },
      ],
      navigation: {
        frames,
        index: 1,
        canBack: true,
        canForward: true,
        reviewing: false,
        restoring: false,
        working: false,
        diverged: false,
        go() {},
        back() {},
        forward() {},
        close() {},
      },
    });
  try {
    render(['start', 'step', 'step', 'conclusion']);
    const button = shadow.querySelector<HTMLButtonElement>('button[aria-label="Step 1 of 2"]')!;
    button.focus();
    render(['start', 'step', 'step', 'step', 'conclusion']);
    return {
      focused: shadow.activeElement?.getAttribute('aria-label'),
      retained: shadow.activeElement === button,
      names: [...shadow.querySelectorAll('[data-vacp-trail] button')].map((node) => node.getAttribute('aria-label')),
    };
  } finally {
    renderer.dispose?.();
  }
}

/** A recorded step of a two-step request by `vacpAgentActor`, drawn with the host's labels and left on screen. */
export function showRecordedStep(
  labels: BrowserPresenceOptions['labels'],
  { reviewing, working }: { reviewing: boolean; working: boolean },
) {
  const renderer = createBrowserPresenceRenderer({ motion: 'reduced', hover: false, labels });
  renderer.render({
    reason: 'activity',
    activities: [
      {
        actor: vacpAgentActor,
        phase: reviewing ? 'reviewing' : 'completed',
        recordId: 'step',
        frame: 'step',
        summary: 'Die Laborwerte sind gefiltert.',
        target: null,
        freshness: 'current',
      },
    ],
    navigation: {
      frames: ['start', 'step', 'step', 'conclusion'],
      index: 1,
      canBack: true,
      canForward: true,
      reviewing,
      restoring: false,
      working,
      diverged: true,
      go() {},
      back() {},
      forward() {},
      close() {},
    },
  });
}
