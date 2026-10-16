import embed from 'vega-embed';
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { createVegaLitePresentation } from '@vacp/adapter-vega-lite/presentation';
import type { VacpDuckDbClient } from '@vacp/data-duckdb';
import { installExampleRuntime } from '@vacp/example-shared';
import { exampleOptions } from '@vacp/example-shared/config';
import type { GalleryEntry } from './gallery';

/** Embed one spec with Vega-Lite, then expose its parameters, selections, and data through VACP. */
export async function renderSpec(
  entry: GalleryEntry,
  { stage, signal, duckdb }: { stage: HTMLElement; signal: AbortSignal; duckdb: Promise<VacpDuckDbClient> },
): Promise<() => void> {
  const appId = 'vacp-examples';
  const viewId = `vega-lite/${entry.id}`;
  // Each render works on its own copy, so a spec changed by one render never reaches the next.
  const spec = structuredClone(entry.spec);
  const embedded = await embed(stage, spec, { actions: false, renderer: 'canvas' });
  try {
    signal.throwIfAborted();
    const provider = createVegaLiteProvider({
      root: stage,
      view: embedded.view,
      spec,
      vgSpec: embedded.vgSpec,
      data: { duckdb, sql: exampleOptions.enableSql },
      options: { appId, viewId, vizId: entry.id, title: entry.title },
    });
    await installExampleRuntime({
      sources: [{ provider, presentation: createVegaLitePresentation({ provider, root: stage }) }],
      root: stage,
      sessionKey: viewId,
      analytics: { vacp_app_id: appId, vacp_view_id: viewId, vacp_viz_id: entry.id },
      signal,
    });
  } catch (error) {
    embedded.finalize();
    throw error;
  }
  return () => embedded.finalize();
}
