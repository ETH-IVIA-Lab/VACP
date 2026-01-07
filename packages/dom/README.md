# @vacp/dom

DOM/SVG adapter for VACP.

The preferred integration path is the in-page bridge (`window.__vacp`). This package exists for:

- discoverability (inspect DOM/SVG and see VACP tags),
- offline artifacts (embed VACP graph into exported SVG),
- fallback scraping (when an app can’t install a bridge yet).

## What it provides

- `applyVacpAttributes(...)`: add `data-vacp-*` attributes to elements.
- `applyVacpInteractionAttributes(...)`: add `data-interaction-vacp-*` to interactive targets.
- `embedVacpGraphInSvg(...)`: store the canonical graph in SVG `<metadata type="application/vacp+json">`.
