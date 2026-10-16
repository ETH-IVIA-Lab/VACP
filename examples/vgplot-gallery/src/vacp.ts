import type { Coordinator } from '@uwdata/mosaic-core';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';
import { createVgplotProvider, type VgplotPlotLike, type VgplotTableLike } from '@vacp/adapter-vgplot';
import { createVgplotPresentation } from '@vacp/adapter-vgplot/presentation';
import { countDuckDbTablesOnce, type VacpDuckDbClient } from '@vacp/data-duckdb';
import { installExampleRuntime } from '@vacp/example-shared';
import { exampleOptions } from '@vacp/example-shared/config';
import { abortable } from '@vacp/protocol';
import type { GalleryEntry } from './gallery';

function isPlotLike(value: unknown): value is VgplotPlotLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'marks' in value &&
    'interactors' in value &&
    Array.isArray(value.marks) &&
    Array.isArray(value.interactors)
  );
}

function isTableLike(value: unknown): value is VgplotTableLike {
  return (
    typeof value === 'object' && value !== null && 'requestData' in value && typeof value.requestData === 'function'
  );
}

/** Mosaic exposes each plot and table client as the `value` of the element it renders. */
function discoverClients(root: Element) {
  const plots: Array<{ plotId: string; plot: VgplotPlotLike }> = [];
  const tables: Array<{ tableId: string; table: VgplotTableLike }> = [];
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const value: unknown = 'value' in element ? element.value : undefined;
    if (isPlotLike(value)) plots.push({ plotId: `plot-${plots.length}`, plot: value });
    else if (isTableLike(value)) tables.push({ tableId: `table-${tables.length}`, table: value });
  }
  return { plots, tables };
}

/** Build one spec's views with vgplot, then expose its plots, inputs, tables, and data through VACP. */
export async function renderSpec(
  entry: GalleryEntry,
  context: { stage: HTMLElement; signal: AbortSignal; coordinator: Coordinator; duckdb: VacpDuckDbClient },
): Promise<() => void> {
  const { stage, signal, coordinator, duckdb } = context;
  const appId = 'vacp-examples';
  const viewId = `vgplot/${entry.id}`;
  const api = createAPIContext({ coordinator });
  const { element } = await astToDOM(parseSpec(entry.spec), { api, baseURL: window.location.href });
  // The next spec renders into the same coordinator, so this one's clients disconnect with it.
  const dispose = () => {
    coordinator.clear({ cache: false });
    element.remove();
  };
  try {
    signal.throwIfAborted();
    stage.replaceChildren(element);
    const clients = discoverClients(element);
    // A plot attaches its legends and initializes its interactors when it renders.
    await abortable(signal, () => Promise.all(clients.plots.map(({ plot }) => plot.update?.())));
    const provider = createVgplotProvider({
      root: element,
      ...clients,
      data: { duckdb, sql: exampleOptions.enableSql, describe: countDuckDbTablesOnce(duckdb) },
      options: { appId, viewId, title: entry.title },
    });
    await installExampleRuntime({
      sources: [{ provider, presentation: createVgplotPresentation({ provider, root: element }) }],
      root: element,
      sessionKey: viewId,
      analytics: { vacp_app_id: appId, vacp_view_id: viewId },
      signal,
    });
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
