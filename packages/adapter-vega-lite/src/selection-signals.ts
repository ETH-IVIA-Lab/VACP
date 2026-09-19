/** Vega-Lite allocates data signals before visual signals, avoiding collisions within a selection. */
export function intervalVisualSignals(name: string, fields: readonly unknown[]): Map<string, string> {
  const used = new Set<string>();
  const visual = new Map<string, string>();
  const allocate = (suffix: string) => {
    const base = `${name}_${suffix}`;
    let candidate = base.replace(/\W/g, '_');
    if (/^\d/.test(base)) candidate = `_${candidate}`;
    const stem = candidate;
    for (let index = 1; used.has(candidate); index++) candidate = `${stem}_${index}`;
    used.add(candidate);
    return candidate;
  };
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue;
    const field = 'field' in raw ? raw.field : undefined;
    const channel = 'channel' in raw ? raw.channel : undefined;
    if (typeof field !== 'string') continue;
    allocate(field);
    if (typeof channel === 'string') visual.set(channel, allocate(channel));
  }
  return visual;
}
