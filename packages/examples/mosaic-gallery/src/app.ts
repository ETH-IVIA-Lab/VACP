import type { VgplotPlotLike } from '@vacp/mosaic';
import { installVacpDebugUi } from '@vacp/debug-ui';
import { installVacpOnVgplotDashboard } from '@vacp/mosaic';
import { coordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';

import { buildDemos } from './demos';
import type { GalleryEntry } from './gallery';
import { loadGallery } from './gallery';
import { waitForSvg } from './vgplot-helpers';

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

  const appRoot = app;
  const metaDiv = metaEl;

  const globalKey = '__vacp';

  installVacpDebugUi({ enabled: 'auto', globalKey });

  const mc = coordinator();
  const connector = new DuckDBWASMConnector({ log: false });
  mc.databaseConnector(connector);

  const duckdbClient = {
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
    loadObjectsAsTable: async () => {
      throw new Error('loadObjectsAsTable is not supported in this example (data is managed by Mosaic)');
    },
  };

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
    metaDiv.textContent = entry.meta.description ?? '';

    const ast = parseSpec(entry.spec);
    const api = createAPIContext({ coordinator: mc });
    const { element } = await astToDOM(ast, { api, baseURL: window.location.href });
    appRoot.replaceChildren(element);

    const plotEls = element.classList.contains('plot')
      ? [element as HTMLElement]
      : Array.from(element.querySelectorAll<HTMLElement>('.plot'));
    if (!plotEls.length) throw new Error('No vgplot element(s) found');

    const plots = await Promise.all(
      plotEls.map(async (plotEl, idx) => {
        const plot = (plotEl as unknown as { value?: unknown }).value;
        if (!plot) throw new Error('vgplot element does not expose plot instance via .value');
        const svg = await waitForSvg(plotEl);
        return { plotId: `plot-${idx}`, plot: plot as VgplotPlotLike, svg };
      }),
    );

    installVacpOnVgplotDashboard({
      root: element,
      plots,
      options: {
        appId: 'vacp-examples',
        viewId: `mosaic/${entry.id}`,
        title: entry.meta.title,
        globalKey,
        demos: buildDemos(entry),
        duckdbClient,
      },
    });
  };

  selectEl.addEventListener('change', () => {
    const id = selectEl.value;
    window.location.hash = id;
    const entry = gallery.find((g) => g.id === id);
    if (entry) {
      void render(entry).catch((err) => {
        metaDiv.textContent = `Render failed: ${String(err)}`;
      });
    }
  });

  const initial = gallery.find((g) => g.id === selectEl.value);
  if (initial) await render(initial);
  else if (gallery[0]) {
    selectOption(selectEl, gallery[0].id);
  }
}
