import type { VacpPlaybook } from '@vacp/core';
import { playbook, type VacpPlaybookBuilder } from '@vacp/kit';
import type { VgplotPlotLike, VgplotTableLike } from '@vacp/mosaic';

import { roundNum } from './playbooks/domains';
import { resolveInteractorPlaybooks } from './playbooks/interactor-playbooks';

export type MosaicPlaybookEntry = {
  id: string;
  meta: { title: string; description?: string };
  spec: unknown;
};

type PlaybookContext = {
  entry: MosaicPlaybookEntry;
  root: ParentNode;
  viewBase: string;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables: Array<{ tableId: string; table: VgplotTableLike }>;
};

function anySpecNode(obj: unknown, pred: (node: Record<string, unknown>) => boolean): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some((v) => anySpecNode(v, pred));
  const rec = obj as Record<string, unknown>;
  if (pred(rec)) return true;
  return Object.values(rec).some((v) => anySpecNode(v, pred));
}

function specHasDataSource(entry: MosaicPlaybookEntry): boolean {
  const top = entry.spec && typeof entry.spec === 'object' ? (entry.spec as Record<string, unknown>) : null;
  if (top && top.data && typeof top.data === 'object' && !Array.isArray(top.data) && Object.keys(top.data as object).length > 0) {
    return true;
  }
  return anySpecNode(entry.spec, (n) => {
    if (typeof n.from === 'string') return true;
    const d = n.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    const rec = d as Record<string, unknown>;
    return typeof rec.from === 'string' || typeof rec.file === 'string';
  });
}

function hasQuerySelectorAll(root: ParentNode): root is ParentNode & { querySelectorAll: (sel: string) => NodeListOf<Element> } {
  return typeof (root as any)?.querySelectorAll === 'function';
}

function defaultHandleRef(ctx: PlaybookContext): string | null {
  const plotId = ctx.plots[0]?.plotId;
  if (plotId) return `${ctx.viewBase}/${plotId}/data/main`;
  const tableId = ctx.tables[0]?.tableId;
  if (tableId) return `${ctx.viewBase}/${tableId}/data/main`;
  return null;
}

function inputLabel(el: Element): string | undefined {
  const t = el.querySelector('label')?.textContent?.trim() ?? '';
  return t ? t : undefined;
}

function appendPlaybookSteps(builder: VacpPlaybookBuilder, pb: VacpPlaybook): number {
  let actionCount = 0;
  for (const s of pb.steps ?? []) {
    if (s.call) {
      actionCount += 1;
      builder.action(s.title, s.call, { description: s.description });
    } else {
      builder.step(s.title, { description: s.description });
    }
  }
  return actionCount;
}

function collectInputTargets(ctx: PlaybookContext): Array<{ ref: string; label?: string; setIndex: number | null; setValue: number | null }> {
  if (!hasQuerySelectorAll(ctx.root)) return [];
  const els = Array.from(ctx.root.querySelectorAll('.input'));
  return els.map((el, i) => {
    const ref = `${ctx.viewBase}/input/${i}`;
    const label = inputLabel(el);
    const select = el.querySelector('select') as HTMLSelectElement | null;
    const optionCount = select?.options?.length ?? 0;
    const setIndex = optionCount >= 2 ? 1 : null;

    const range = el.querySelector('input[type="range"]') as HTMLInputElement | null;
    const min = range ? Number(range.min) : NaN;
    const max = range ? Number(range.max) : NaN;
    const setValue = Number.isFinite(min) && Number.isFinite(max) ? roundNum(min + (max - min) * 0.5) : null;

    return { ref, label, setIndex, setValue };
  });
}

function buildPerSpecPlaybook(ctx: PlaybookContext): VacpPlaybook[] {
  const title = ctx.entry.meta.title || ctx.entry.id;
  const desc = ctx.entry.meta.description ?? undefined;

  const b = playbook({
    id: `${ctx.entry.id}-playbook`,
    title: `Playbook: ${title}`,
    description: desc,
  });

  let actionCount = 0;

  if (desc) {
    b.note('What this spec shows', desc);
  }

  const inputs = collectInputTargets(ctx);
  if (inputs.length) {
    b.note('Inputs', 'Drive Mosaic input widgets via semantic actions (best-effort), then compare with manual interaction.');
    for (const input of inputs.slice(0, 3)) {
      const label = input.label ? `“${input.label}”` : `input`;
      if (input.setIndex !== null) {
        actionCount += 1;
        b.action(`Set ${label} (option index ${input.setIndex})`, {
          name: 'mosaic.set_input_option_index',
          params: { ref: input.ref, index: input.setIndex },
        });
      } else if (input.setValue !== null) {
        actionCount += 1;
        b.action(`Set ${label} (value ${input.setValue})`, { name: 'mosaic.set_input_value', params: { ref: input.ref, value: input.setValue } });
      } else {
        b.step(`Change ${label} manually`, { description: `No safe scripted value could be inferred for ${input.ref}.` });
      }
      actionCount += 1;
      b.action(`Clear ${label}`, { name: 'mosaic.clear_input', params: { ref: input.ref } });
    }
  }

  const interactorPlaybooks = resolveInteractorPlaybooks({ entry: ctx.entry, plots: ctx.plots });
  if (interactorPlaybooks.length) {
    for (const pb of interactorPlaybooks) {
      if (pb.description && pb.description.trim()) b.note(pb.title, pb.description);
      else b.step(pb.title);
      actionCount += appendPlaybookSteps(b, pb);
    }
  }

  if (ctx.tables.length) {
    const tableId = ctx.tables[0]?.tableId ?? 'table-0';
    const handleRef = `${ctx.viewBase}/${tableId}/data/main`;
    const columns = (ctx.tables[0]?.table?.columns ?? null) as unknown;
    const names = Array.isArray(columns) ? columns.map((c) => String(c)).filter(Boolean) : [];

    b.note('Tables', 'Use semantic table actions (sort + pagination).');
    if (names.length) {
      const column = names[0]!;
      actionCount += 1;
      b.action('Sort by a column (descending)', { name: 'mosaic.table_set_sort', params: { tableId, column, desc: true } });
      actionCount += 1;
      b.action('Set page size (50 rows)', { name: 'mosaic.table_set_page', params: { tableId, offset: 0, limit: 50 } });
    } else {
      b.step('Table columns could not be inferred', { description: 'Skipping table sort/page actions for safety.' });
    }

    if (specHasDataSource(ctx.entry)) {
      actionCount += 1;
      b.action('Preview current page (DuckDB)', { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT * FROM vacp_handle LIMIT 10' } });
    }

    if (names.length) {
      actionCount += 1;
      b.action('Scroll down (offset 200)', { name: 'mosaic.table_set_page', params: { tableId, offset: 200, limit: 50 } });
      actionCount += 1;
      b.action('Clear sort', { name: 'mosaic.table_clear_sort', params: { tableId } });
    }
  }

  const handleRef = defaultHandleRef(ctx);
  if (handleRef && specHasDataSource(ctx.entry)) {
    b.note('DuckDB SQL', 'Compare the full dataset (`vacp_all`) with the current view/selection (`vacp_handle`).');
    actionCount += 1;
    b.action('Count all rows', { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n_all FROM vacp_all' } });
    actionCount += 1;
    b.action('Count current view/selection', { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n_sel FROM vacp_handle' } });
    actionCount += 1;
    b.action('Preview selected rows', { name: 'vacp.data_sql', params: { handleRef, sql: 'SELECT * FROM vacp_handle LIMIT 10' } });
  }

  if (actionCount === 0) return [];
  return [b.build()];
}

export function buildMosaicPlaybooks(args: {
  entry: MosaicPlaybookEntry;
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike }>;
}): VacpPlaybook[] {
  const viewBase = `vacp://vacp-examples/mosaic/${args.entry.id}`;
  const entry = args.entry;
  const tables = args.tables ?? [];
  return buildPerSpecPlaybook({ entry, root: args.root, viewBase, plots: args.plots, tables });
}
