import embed from 'vega-embed';
import { createVegaLiteProvider } from '@ethivia/vacp-vega-lite';
import { createVegaLitePresentation } from '@ethivia/vacp-vega-lite/presentation';
import { vacpAgentActor, type VacpRef } from '@ethivia/vacp-protocol';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@ethivia/vacp-runtime';
import { createRefPresenceResolver } from '@ethivia/vacp-presence/dom';
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
function cursorFixture({ width, height } = { width: 1000, height: 600 }) {
  const frame = document.createElement('iframe');
  frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0`;
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

type Region = { x: number; y: number; width: number; height: number };
type Geometry = import('@ethivia/vacp-presence').PresenceGeometry;

function covered(label: DOMRect, region: Region) {
  return (
    Math.max(0, Math.min(label.right, region.x + region.width) - Math.max(label.left, region.x)) *
    Math.max(0, Math.min(label.bottom, region.y + region.height) - Math.max(label.top, region.y))
  );
}

/** How far the label reaches past the edges of a viewport of `size`. */
function beyond(label: DOMRect, size: { width: number; height: number }) {
  return Math.max(0, -label.left, -label.top, label.right - size.width, label.bottom - size.height);
}

/** The rectangle a target geometry spans on screen. */
function span(geometry: Geometry): Region {
  if (geometry.kind === 'region') return geometry;
  const points = geometry.kind === 'path' ? geometry.points : [geometry.point];
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
  };
}

/**
 * The most of `region` the label covers, now and along any movement of its root. Every step shows the
 * same words, so the label never resizes and its root carries every movement. Animations run on the
 * document timeline, which the fixture's clock does not drive, so each movement is sought through and
 * finished.
 */
function coverage(label: Element, region: Region) {
  let most = covered(label.getBoundingClientRect(), region);
  for (const movement of label.getAnimations()) {
    const end = Number(movement.effect!.getComputedTiming().endTime);
    for (let time = 0; time <= end; time += 4) {
      movement.currentTime = time;
      most = Math.max(most, covered(label.getBoundingClientRect(), region));
    }
    movement.finish();
  }
  return most;
}

/** Show one step of an agent acting on `geometry`, and return the overlay's shadow root. */
function showStep(doc: Document, renderer: ReturnType<typeof createBrowserPresenceRenderer>, geometry: Geometry) {
  renderer.render({
    reason: 'activity',
    activities: [
      {
        actor: { id: 'agent', kind: 'agent' },
        phase: 'acting',
        summary: 'Selecting the next row',
        freshness: 'current',
        target: { surface: 'viewport', precision: 'exact', geometry },
      },
    ],
  });
  return [...doc.querySelectorAll('[data-vacp-presence]')].at(-1)!.shadowRoot!;
}

/**
 * Step the cursor between targets on the fixture's clock, and measure the most of each destination its
 * label covers and how far the label reaches past the viewport.
 */
export function measureBubbleRides() {
  const view = { width: 1280, height: 900 };
  const fixture = cursorFixture(view);
  const region = (x: number, y: number, width: number, height: number) =>
    ({ kind: 'region', x, y, width, height }) as const;
  const row = (y: number) => region(0, y, 1280, 48);
  // A path from `top` across the page. Its last point puts the cursor near the bottom edge, nearest the side below.
  const tall = (top: number): Geometry => ({
    kind: 'path',
    points: [
      { x: 12, y: top },
      { x: 1268, y: 648 },
      { x: 640, y: 640 },
    ],
  });
  const journeys: Record<string, Geometry[]> = {
    'between two regions': [region(180, 500, 230, 158), region(470, 580, 220, 88)],
    'down and up a list': [row(100), row(420), row(700), row(420)],
    'to a row that moves': [row(100), row(420), row(422)],
    'to a tall target that stays and then grows': [region(628, 28, 24, 24), tall(172), tall(172), tall(162)],
  };
  let now = 0;
  const rides: Array<{ journey: string; step: number; covered: number; beyond: number }> = [];
  try {
    for (const [journey, targets] of Object.entries(journeys)) {
      const renderer = fixture.create({ motion: 'full', hover: false });
      for (const [step, geometry] of targets.entries()) {
        const overlay = showStep(fixture.doc, renderer, geometry);
        const label = overlay.querySelector('[data-vacp-bubble]')!;
        let most = 0;
        let farthest = 0;
        for (const end = now + 1000; now < end; now += 4) {
          fixture.tick(now);
          farthest = Math.max(farthest, beyond(label.getBoundingClientRect(), view));
          most = Math.max(most, coverage(label, span(geometry)));
        }
        if (step) rides.push({ journey, step, covered: most, beyond: farthest });
      }
      renderer.dispose?.();
    }
    return rides;
  } finally {
    fixture.dispose();
  }
}

/** Ride the cursor to a wide region near the top edge, deliver the step again, and measure how far the label moves. */
export function measureBubbleRedelivery() {
  const fixture = cursorFixture({ width: 1280, height: 900 });
  const renderer = fixture.create({ motion: 'full', hover: false });
  const region: Geometry = { kind: 'region', x: 220, y: 40, width: 820, height: 70 };
  let now = 0;
  const rest = (label: Element) => {
    for (const end = now + 1000; now < end; now += 4) fixture.tick(now);
    for (const movement of label.getAnimations()) movement.finish();
    return label.getBoundingClientRect();
  };
  try {
    showStep(fixture.doc, renderer, { kind: 'point', point: { x: 400, y: 30 } });
    const label = showStep(fixture.doc, renderer, region).querySelector('[data-vacp-bubble]')!;
    const landed = rest(label);
    showStep(fixture.doc, renderer, region);
    const again = rest(label);
    return Math.hypot(again.x - landed.x, again.y - landed.y);
  } finally {
    fixture.dispose();
  }
}

/** Jump the cursor to a wide region under reduced motion, and measure where its label settles. */
export function measureBubbleJump() {
  const fixture = cursorFixture({ width: 1280, height: 900 });
  const renderer = fixture.create({ motion: 'reduced' });
  const region = { x: 130, y: 320, width: 650, height: 50 };
  try {
    showStep(fixture.doc, renderer, { kind: 'point', point: { x: 980, y: 350 } });
    const overlay = showStep(fixture.doc, renderer, { kind: 'region', ...region });
    const label = overlay.querySelector('[data-vacp-bubble]')!.getBoundingClientRect();
    const { e: x, f: y } = overlay.querySelector<SVGGElement>('g[data-vacp-phase]')!.getScreenCTM()!;
    return {
      covered: covered(label, region),
      distance: Math.hypot(Math.max(label.left - x, 0, x - label.right), Math.max(label.top - y, 0, y - label.bottom)),
    };
  } finally {
    fixture.dispose();
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

/** An unnarrated recorded step of a two-step request by `vacpAgentActor`, drawn with the host's labels. */
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

/**
 * A settings form that marks its threshold input with `data-vacp-ref`, below the viewport, and marks nothing
 * for its label. An agent sets both in one turn. `shown` lists the steps reported while the turn ran, and
 * `unplaced` the steps reported once it ended.
 */
export async function presentMarkedSteps() {
  const threshold: VacpRef = 'vacp://settings/threshold';
  const label: VacpRef = 'vacp://settings/label';
  const form = document.createElement('form');
  form.style.cssText = `position:absolute;left:0;top:${innerHeight + 1000}px`;
  form.innerHTML = `<input name="threshold" type="number" data-vacp-ref="${threshold}"><input name="label">`;
  document.body.append(form);
  const actions = new VacpActionRegistry();
  for (const ref of [threshold, label])
    actions.register(
      {
        name: `${ref.split('/').at(-1)}.set`,
        description: 'Set a setting',
        operation: { kind: 'mutation', affects: [ref] },
      },
      () => true,
      { parse: (value) => value, focus: () => ({ ref }) },
    );
  const provider = createVacpProvider({
    source: { id: 'vacp-source://settings', type: 'form', title: 'Settings' },
    actions,
    project: () => ({
      graph: {
        nodes: [threshold, label].map((ref) => ({ ref, kind: 'Param', layer: 'ConfigLayer' })),
        edges: [],
        actions: actions.list(),
      },
      state: {},
    }),
    subscribe: () => () => {},
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  const unplaced: string[] = [];
  const presence = createBrowserPresence(runtime, {
    appearance: { motion: 'reduced' },
    lingerMs: 0,
    onUnplaced: (activity) => unplaced.push(activity.execution!.name),
  });
  presence.attach(provider, { resolve: createRefPresenceResolver(form) });
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
  const turn = runtime.beginAgentActivity({ actor: vacpAgentActor });
  try {
    await runtime.execute({ name: 'threshold.set' }, { actor: vacpAgentActor });
    await settle();
    const placed = presence.getSnapshot()[0]?.target;
    const { x, y, width, height } = form.querySelector('[name="threshold"]')!.getBoundingClientRect();
    await runtime.execute({ name: 'label.set' }, { actor: vacpAgentActor });
    await settle();
    scrollBy(0, 40);
    await settle();
    const shown = [...unplaced];
    turn.end();
    await settle();
    return {
      shown,
      unplaced,
      viewportHeight: innerHeight,
      placed,
      threshold: { kind: 'region', x, y, width, height },
    };
  } finally {
    presence.dispose();
    runtime.dispose();
    form.remove();
  }
}
