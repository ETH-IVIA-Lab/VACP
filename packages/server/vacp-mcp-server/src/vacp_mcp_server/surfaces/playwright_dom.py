from __future__ import annotations

from dataclasses import dataclass

from playwright.async_api import Page

from vacp_mcp_server.surfaces.base import ActionCall, ActionResult, Surface

"""
DOM/SVG fallback surface (project concepts).

This surface exists for:
- non-cooperative apps that only annotate DOM/SVG
- debugging and inspection (DOM attributes are easy to view)
- resilience when the window bridge is not available

Trade-off:
- DOM scan is slower and less stable than the window bridge.
- It should not be the primary integration path for dynamic, rerendering apps.
"""


@dataclass(frozen=True)
class DomScanOptions:
    include_data_layer: bool = False
    max_elements: int = 20_000


EXTRACT_VACP_FROM_DOM_JS = """
(opts) => {
  const maxElements = opts?.max_elements ?? 20000;
  const includeDataLayer = !!opts?.include_data_layer;

  const vacpElems = [];
  const interactionElems = [];

  const all = document.querySelectorAll('*');
  for (
    let i = 0;
    i < all.length && vacpElems.length + interactionElems.length < maxElements;
    i++
  ) {
    const el = all[i];
    const attrs = Array.from(el.attributes);
    const hasVacp = attrs.some(a => a.name.startsWith('data-vacp-'));
    const hasInt = attrs.some(a => a.name.startsWith('data-interaction-vacp-'));

    if (hasVacp) {
      const data = {};
      for (const a of attrs) {
        if (a.name.startsWith('data-vacp-')) {
          const key = a.name.slice('data-vacp-'.length);
          data[key] = a.value;
        }
      }
      if (!includeDataLayer && data.layer === 'DataLayer') continue;
      vacpElems.push({
        node: {
          tagName: el.tagName,
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
        },
        data,
      });
    }

    if (hasInt) {
      const data = {};
      for (const a of attrs) {
        if (a.name.startsWith('data-interaction-vacp-')) {
          const key = a.name.slice('data-interaction-vacp-'.length);
          data[key] = a.value;
        }
      }
      interactionElems.push({
        node: {
          tagName: el.tagName,
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
        },
        data,
      });
    }
  }

  // Prefer canonical graphs embedded into SVG metadata.
  const graphs = [];
  const metas = document.querySelectorAll(
    'svg metadata[type="application/vacp+json"]'
  );
  metas.forEach(m => {
    try {
      graphs.push(JSON.parse(m.textContent || ''));
    } catch {}
  });

  return { vacpElems, interactionElems, graphs };
}
"""


class PlaywrightDomSurface(Surface):
    """
    Fallback surface: scans DOM annotations.

    This is useful for non-cooperative apps or debugging, but is not intended as
    the primary integration path for Mosaic.
    """

    def __init__(self, page: Page, *, options: DomScanOptions | None = None):
        self._page = page
        self._options = options or DomScanOptions()

    async def get_capabilities(self) -> dict[str, object]:
        raw = await self._page.evaluate(
            EXTRACT_VACP_FROM_DOM_JS,
            {
                'include_data_layer': self._options.include_data_layer,
                'max_elements': self._options.max_elements,
            },
        )
        graphs = raw.get('graphs') if isinstance(raw, dict) else None
        if isinstance(graphs, list) and graphs:
            # If there are multiple graphs, return the first for now.
            return graphs[0]
        return {
            'version': '0.0.0',
            'createdAt': '',
            'graph': {
                'version': '0.0.0',
                'nodes': [],
                'edges': [],
                'actions': [],
            },
            'dom': raw,
        }

    async def get_state(self) -> dict[str, object]:
        # DOM-only: no canonical state; return empty with dom evidence.
        raw = await self._page.evaluate(
            EXTRACT_VACP_FROM_DOM_JS,
            {'include_data_layer': False, 'max_elements': self._options.max_elements},
        )
        return {'version': '0.0.0', 'createdAt': '', 'state': {}, 'dom': raw}

    async def execute(self, call: ActionCall) -> ActionResult:
        # DOM-only surface cannot execute without a bridge/gateway.
        return ActionResult(
            call_id=call.call_id,
            ok=False,
            error={'message': 'No executable surface (missing window bridge)'},
        )
