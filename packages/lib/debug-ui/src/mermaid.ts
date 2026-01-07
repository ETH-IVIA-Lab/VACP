function normalizeMermaidText(text: string): string {
  /**
   * Defensive normalization:
   * - Some toolchains emit literal "\\n" sequences; Mermaid will render them as
   *   backslash+n instead of newlines. Convert those to real newlines.
   */
  return text.replaceAll('\\n', '\n').trim();
}

export async function renderMermaidToHost(host: HTMLElement, mermaidText: string): Promise<void> {
  host.textContent = '';
  try {
    const mod = await import('mermaid');
    const mermaid = mod.default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', flowchart: { htmlLabels: true } });
    const id = `vacp_${Math.random().toString(16).slice(2)}`;
    const res = await mermaid.render(id, normalizeMermaidText(mermaidText));
    host.innerHTML = res.svg;
  } catch (err) {
    host.textContent = `Mermaid render failed: ${String(err)}`;
  }
}
