import type { VgplotPlotLike, VgplotTableLike } from '@vacp/vgplot';
import { installVacpDebugUI } from '@vacp/kit';
import type { VacpDuckDbClient } from '@vacp/duckdb';
import { coordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';
import { marked } from 'marked';

import type { GalleryEntry } from './gallery';
import { loadGallery } from './gallery';
import { installVacp, waitForActionInteractors } from './vacp';
import { waitForSvgMaybe } from './vgplot-helpers';

function isPlotLike(value: unknown): value is VgplotPlotLike {
  if (!value || typeof value !== 'object') return false;
  const anyV = value as any;
  return Array.isArray(anyV.marks) && Array.isArray(anyV.interactors);
}

function isTableLike(value: unknown): value is VgplotTableLike {
  if (!value || typeof value !== 'object') return false;
  const anyV = value as any;
  return typeof anyV.requestData === 'function' && (typeof anyV.from === 'string' || anyV.from == null);
}

function discoverVgplotHosts(root: Element): { plotHosts: Element[]; tableHosts: Element[] } {
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  const plots = all.filter((el) => isPlotLike((el as any).value));
  const tables = all.filter((el) => !isPlotLike((el as any).value) && isTableLike((el as any).value));
  return { plotHosts: Array.from(new Set(plots)), tableHosts: Array.from(new Set(tables)) };
}

function selectOption(selectEl: HTMLSelectElement, id: string): void {
  selectEl.value = id;
  selectEl.dispatchEvent(new Event('change', { bubbles: true }));
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function renderDescriptionMarkdown(description: string): string {
  try {
    return marked.parse(description, { async: false }) as string;
  } catch {
    return `<p>${escapeHtml(description)}</p>`;
  }
}

export async function run(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  const selectEl = document.querySelector<HTMLSelectElement>('#spec');
  const metaEl = document.querySelector<HTMLDivElement>('#spec-meta');
  if (!app || !selectEl || !metaEl) {
    throw new Error('Missing root elements');
  }

  let renderToken = 0;

  // Debug overlay: inspects the VACP bridge and provides time travel, actions, and DuckDB SQL.
  void installVacpDebugUI();

  // VGPlot's coordinator owns the shared in-browser DuckDB instance.
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
      throw new Error('loadObjectsAsTable is not supported in this example (data is managed by VGPlot)');
    },
  };

  // Gallery UI: list all available YAML specs (mirrors VGPlot's own spec gallery idea).
  const gallery = loadGallery();
  gallery.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.meta.title;
    selectEl.append(opt);
  });

  const findGalleryEntry = (id: string): GalleryEntry | undefined => gallery.find((g) => g.id === id);

  const selectIdFromHash = (): string | null => {
    let rawHash = window.location.hash;
    try {
      rawHash = decodeURIComponent(rawHash);
    } catch {
      // Keep raw hash if decoding fails.
    }
    rawHash = rawHash.replace(/^#/, '').trim();
    if (!rawHash) return null;
    return findGalleryEntry(rawHash) ? rawHash : null;
  };

  const render = async (entry: GalleryEntry): Promise<void> => {
    const token = (renderToken += 1);
    // Render: translate the spec to VGPlot DOM, then attach VACP on top of the resulting plots.
    const description = entry.meta.description ?? '';
    metaEl.innerHTML = description ? renderDescriptionMarkdown(description) : '';

    const ast = parseSpec(entry.spec);
    const api = createAPIContext({ coordinator: mc });
    const { element } = await astToDOM(ast, { api, baseURL: window.location.href });
    if (token !== renderToken) return;
    app.replaceChildren(element);

    const { plotHosts, tableHosts } = discoverVgplotHosts(element);
    const plots = await Promise.all(
      plotHosts.map(async (host, idx) => {
        const plot = (host as any).value;
        const svg = await waitForSvgMaybe(host);
        return { plotId: `plot-${idx}`, plot, element: svg ?? host, svg: svg ?? undefined };
      }),
    );
    if (token !== renderToken) return;

    const tables = tableHosts.map((host, idx) => {
      const table = (host as any).value;
      return { tableId: `table-${idx}`, table, element: host };
    });

    const interactorsReady = await waitForActionInteractors({
      entryId: entry.id,
      plots,
      isStale: () => token !== renderToken,
    });
    if (!interactorsReady || token !== renderToken) return;

    // VACP layer: attaches a bridge (`window.__vacp`), actions, state snapshots, and DuckDB access.
    await installVacp({ root: element, plots, tables, entry, duckdbClient });
  };

  const renderById = (id: string): void => {
    const entry = findGalleryEntry(id);
    if (!entry) return;
    if (selectEl.value !== id) selectEl.value = id;
    void render(entry).catch((err) => {
      metaEl.textContent = `Render failed: ${String(err)}`;
    });
  };

  selectEl.addEventListener('change', () => {
    const id = selectEl.value;
    if (window.location.hash !== `#${id}`) window.location.hash = id;
    renderById(id);
  });

  window.addEventListener('hashchange', () => {
    const hashId = selectIdFromHash();
    if (!hashId || hashId === selectEl.value) return;
    renderById(hashId);
  });

  const initialId = selectIdFromHash() ?? gallery[0]?.id ?? '';
  if (initialId) {
    const initialEntry = findGalleryEntry(initialId);
    if (initialEntry) {
      if (selectEl.value !== initialId) selectEl.value = initialId;
      await render(initialEntry).catch((err) => {
        metaEl.textContent = `Render failed: ${String(err)}`;
      });
    }
  } else if (gallery[0]) selectOption(selectEl, gallery[0].id);
}
