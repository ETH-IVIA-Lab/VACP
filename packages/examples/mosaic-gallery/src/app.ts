import type { VgplotPlotLike } from '@vacp/mosaic';
import { installVacpDebugUi } from '@vacp/debug-ui';
import type { VacpDuckDbClient } from '@vacp/duckdb';
import { coordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';

import type { GalleryEntry } from './gallery';
import { loadGallery } from './gallery';
import { installVacpLayerForMosaic } from './vacp';
import { waitForSvgMaybe } from './vgplot-helpers';

function isPlotLike(value: unknown): value is VgplotPlotLike {
  if (!value || typeof value !== 'object') return false;
  const anyV = value as any;
  return Array.isArray(anyV.marks) && Array.isArray(anyV.interactors);
}

function discoverPlotHosts(root: Element): Element[] {
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  const found = all.filter((el) => isPlotLike((el as any).value));
  return Array.from(new Set(found));
}

function selectOption(selectEl: HTMLSelectElement, id: string): void {
  selectEl.value = id;
  selectEl.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function run(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  const selectEl = document.querySelector<HTMLSelectElement>('#spec');
  const metaEl = document.querySelector<HTMLDivElement>('#spec-meta');
  if (!app || !selectEl || !metaEl) {
    throw new Error('Missing root elements');
  }

  const globalKey = '__vacp';

  // Dev-only overlay: inspects the VACP bridge and provides time travel + actions + DuckDB SQL.
  installVacpDebugUi({ enabled: 'auto', globalKey });

  // Mosaic's coordinator owns the shared in-browser DuckDB instance.
  const mc = coordinator();
  const connector = new DuckDBWASMConnector({ log: false });
  mc.databaseConnector(connector);

  const duckdbClient: VacpDuckDbClient = {
    getConnection: async () => await connector.getConnection(),
    exec: async (sql: string) => {
      await mc.query(sql, { type: 'json', cache: false });
    },
    queryJson: async (sql: string) => {
      const rows = (await mc.query(sql, { type: 'json', cache: false })) as Record<string, unknown>[];
      const cols = rows[0] ? Object.keys(rows[0]) : [];
      return { columns: cols, rows };
    },
    queryArrowIpcBase64: async (sql: string) => {
      const con = await connector.getConnection();
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        con.useUnsafe(async (bindings, connId) => {
          try {
            const buf = await bindings.runQuery(connId, sql);
            resolve(buf);
          } catch (err) {
            reject(err);
          }
        });
      });
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      return btoa(binary);
    },
    loadObjectsAsTable: async (
      _tableName: string,
      _rows: Record<string, unknown>[],
      _options?: { create?: boolean },
    ) => {
      throw new Error('loadObjectsAsTable is not supported in this example (data is managed by Mosaic)');
    },
  };

  // Gallery UI: list all available YAML specs (mirrors Mosaic's own spec gallery idea).
  const gallery = loadGallery();
  gallery.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.meta.title;
    selectEl.append(opt);
  });

  const url = new URL(window.location.href);
  const initialId = url.hash ? url.hash.slice(1) : '';
  if (initialId && gallery.some((g) => g.id === initialId)) selectEl.value = initialId;
  else selectEl.value = gallery[0]?.id ?? '';

  const render = async (entry: GalleryEntry): Promise<void> => {
    // Render: translate spec → vgplot DOM, then attach VACP on top of the resulting plots.
    metaEl.textContent = entry.meta.description ?? '';

    const ast = parseSpec(entry.spec);
    const api = createAPIContext({ coordinator: mc });
    const { element } = await astToDOM(ast, { api, baseURL: window.location.href });
    app.replaceChildren(element);

    const plotHosts = discoverPlotHosts(element);
    const plots = await Promise.all(
      plotHosts.map(async (host, idx) => {
        const plot = (host as any).value;
        const svg = await waitForSvgMaybe(host);
        return { plotId: `plot-${idx}`, plot, element: svg ?? host, svg: svg ?? undefined };
      }),
    );

    // VACP layer: attaches a bridge (`window.__vacp`), actions, state snapshots, and DuckDB access.
    installVacpLayerForMosaic({ root: element, plots, entry, globalKey, duckdbClient });
  };

  selectEl.addEventListener('change', () => {
    const id = selectEl.value;
    window.location.hash = id;
    const entry = gallery.find((g) => g.id === id);
    if (entry) {
      void render(entry).catch((err) => {
        metaEl.textContent = `Render failed: ${String(err)}`;
      });
    }
  });

  const initial = gallery.find((g) => g.id === selectEl.value);
  if (initial) await render(initial);
  else if (gallery[0]) {
    selectOption(selectEl, gallery[0].id);
  }
}
