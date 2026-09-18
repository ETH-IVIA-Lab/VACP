export async function waitForSvgMaybe(root: ParentNode, timeoutMs = 1_500): Promise<SVGElement | null> {
  const start = performance.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const svg = root.querySelector('svg');

    if (svg) return svg;

    if (performance.now() - start > timeoutMs) return null;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}
