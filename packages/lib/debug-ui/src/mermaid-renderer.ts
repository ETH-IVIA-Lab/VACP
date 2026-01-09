import mermaid from 'mermaid';

function normalizeMermaidText(text: string): string {
  /**
   * Defensive normalization:
   * - Some toolchains emit literal "\\n" sequences; Mermaid will render them as
   *   backslash+n instead of newlines. Convert those to real newlines.
   */
  return text.replaceAll('\\n', '\n').trim();
}

let mermaidInitialized = false;

export async function renderMermaidToHost(host: HTMLElement, mermaidText: string): Promise<void> {
  host.textContent = '';
  try {
    if (!mermaidInitialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', flowchart: { htmlLabels: true } });
      mermaidInitialized = true;
    }
    const id = `vacp_${Math.random().toString(16).slice(2)}`;
    const res = await mermaid.render(id, normalizeMermaidText(mermaidText));
    host.innerHTML = res.svg;

    const svg = host.querySelector('svg');
    if (svg) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'VACP capability graph');

      // Ensure the SVG scales to the available host viewport.
      // Mermaid sometimes emits fixed width/height; prefer a responsive viewBox.
      //
      // Mermaid also sets an inline `max-width: <px>` on the root SVG. That
      // causes the diagram to stop expanding when the debug panel is resized.
      // Override it so the chart can fully use the available pane size.
      (svg as SVGSVGElement).style.maxWidth = 'none';
      (svg as SVGSVGElement).style.maxHeight = 'none';

      const widthAttr = svg.getAttribute('width');
      const heightAttr = svg.getAttribute('height');
      const viewBox = svg.getAttribute('viewBox');
      if (!viewBox && widthAttr && heightAttr) {
        const w = Number.parseFloat(widthAttr);
        const h = Number.parseFloat(heightAttr);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
      }
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      (svg as SVGSVGElement).style.width = '100%';
      (svg as SVGSVGElement).style.height = '100%';
      (svg as SVGSVGElement).style.display = 'block';

      // Make Mermaid nodes focusable so keyboard users can inspect the graph.
      //
      // We rely on GraphModule's event delegation to handle Enter/Space selection.
      svg.querySelectorAll('g.node').forEach((g) => {
        try {
          g.setAttribute('tabindex', '0');
          g.setAttribute('role', 'button');
          const label =
            g.querySelector('title')?.textContent?.trim() ||
            g.querySelector('text')?.textContent?.trim() ||
            g.textContent?.trim() ||
            'node';
          g.setAttribute('aria-label', label);
        } catch {
          // ignore: best-effort accessibility tweaks
        }
      });
    }
  } catch (err) {
    host.textContent = `Mermaid render failed: ${String(err)}`;
  }
}
