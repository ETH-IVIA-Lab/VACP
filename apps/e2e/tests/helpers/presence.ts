import { expect, type Page } from '@playwright/test';

/**
 * Invoke a registered WebMCP tool the way a browser agent would. Action tools require the step's own
 * sentence; calls that do not test narration get a neutral one.
 */
export async function tool(page: Page, suffix: string, params: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ suffix, params }) => {
      const context = document.modelContext!;
      const action = (await context.getTools()).find((tool) => tool.name.endsWith(suffix));
      if (!action) throw new Error(`Missing tool: ${suffix}`);
      // Chrome reports each registered schema as JSON text.
      const schema = typeof action.inputSchema === 'string' ? JSON.parse(action.inputSchema) : action.inputSchema;
      const required: string[] = schema?.required ?? [];
      const input = required.includes('narration') ? { narration: 'Adjusting the view.', ...params } : params;
      return JSON.parse(await context.executeTool(action, JSON.stringify(input)));
    },
    { suffix, params },
  );
}

type Painted = {
  cursor: { x: number; y: number };
  bubble: { x: number; y: number; width: number; height: number };
  /** Gap between the cursor hotspot and the bubble box, 0 when the box contains it. */
  distance: number;
  /** Bubble area over the step's painted outline. */
  covered: number;
  /** Gap between the bubble box and the step's painted outline, or null without an outline. */
  clearance: number | null;
  moving: boolean;
};

/** Painted geometry: the cursor hotspot, the bubble box, and the step's outline. */
async function painted(page: Page): Promise<Painted | null> {
  return page.evaluate(() => {
    const shadow = document.querySelector('[data-vacp-presence]')?.shadowRoot;
    const pointer = shadow?.querySelector<SVGGElement>('g[data-vacp-phase]');
    const bubble = shadow?.querySelector('[data-vacp-bubble]');
    if (!pointer || !bubble) return null;
    const { e: x, f: y } = pointer.getScreenCTM()!;
    const box = bubble.getBoundingClientRect();
    const cue = shadow!.querySelector<SVGPathElement>('path[data-precision]');
    const outline = cue?.getAttribute('d') ? cue.getBoundingClientRect() : null;
    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    const covered = outline
      ? Math.max(0, Math.min(box.right, outline.right) - Math.max(box.left, outline.left)) *
        Math.max(0, Math.min(box.bottom, outline.bottom) - Math.max(box.top, outline.top))
      : 0;
    const clearance = outline
      ? Math.hypot(
          Math.max(outline.left - box.right, 0, box.left - outline.right),
          Math.max(outline.top - box.bottom, 0, box.top - outline.bottom),
        )
      : null;
    const moving = [bubble, ...shadow!.querySelectorAll('div')].some((node) =>
      node
        .getAnimations()
        .some(
          (animation) =>
            animation.playState === 'running' && isFinite(Number(animation.effect?.getTiming().iterations)),
        ),
    );
    return {
      cursor: { x: Math.round(x), y: Math.round(y) },
      bubble: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      distance: Math.round(Math.hypot(dx, dy)),
      covered: Math.round(covered),
      clearance: clearance === null ? null : Math.round(clearance),
      moving,
    };
  });
}

/** Wait until cursor and bubble have finished their transition to the step. */
export async function settled(page: Page): Promise<Painted> {
  let previous = '';
  await expect
    .poll(
      async () => {
        const now = await painted(page);
        const key = JSON.stringify(now && { cursor: now.cursor, bubble: now.bubble });
        const stable = !!now && !now.moving && key === previous;
        previous = key;
        return stable;
      },
      { intervals: [120] },
    )
    .toBe(true);
  return (await painted(page))!;
}
