import type { VacpActionCall, VacpActionDescriptor, VacpActionResult } from '@vacp/core';
import { ClipboardCopy, Play, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';
import { Input } from '@vacp/debug-ui/ui/components/ui/input';
import { Textarea } from '@vacp/debug-ui/ui/components/ui/textarea';

import type { VacpDebugModuleProps } from './module-types';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  return JSON.parse(t);
}

export function ActionsModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const showTwoCols = rootSize.width >= 980;
  const actions = props.runtime.currentCapabilities.graph.actions ?? [];
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q));
  }, [actions, filter]);

  const [selectedName, setSelectedName] = useState<string>(actions[0]?.name ?? '');
  const selected: VacpActionDescriptor | null = useMemo(
    () => actions.find((a) => a.name === selectedName) ?? actions[0] ?? null,
    [actions, selectedName],
  );

  const [paramsText, setParamsText] = useState<string>('{}');
  const [result, setResult] = useState<VacpActionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    setSelectedName(selected.name);
    setParamsText('{}');
    setResult(null);
    setStatus('idle');
    setError(null);
  }, [selected?.name]);

  const run = async () => {
    if (!selected) return;
    // Executing actions mutates the live app; keep the debug UI in live mode so changes are visible.
    if (props.runtime.mode === 'inspect' && typeof props.bridge.setMode === 'function') {
      props.bridge.setMode('live', { source: 'debug', message: 'auto: back to live for action' });
    }
    setStatus('running');
    setError(null);
    setResult(null);
    let params: unknown;
    try {
      params = parseJson(paramsText);
    } catch (err) {
      setStatus('error');
      setError(`Invalid JSON params: ${String(err)}`);
      return;
    }

    const call: VacpActionCall = { callId: crypto.randomUUID(), name: selected.name, params };
    try {
      const res = typeof props.bridge.dispatch === 'function' ? await props.bridge.dispatch(call, { source: 'debug' }) : await props.bridge.execute(call);
      setResult(res);
      setStatus(res.ok ? 'idle' : 'error');
      if (!res.ok) setError(res.error?.message ?? 'Action failed');
    } catch (err) {
      setStatus('error');
      setError(String(err));
    }
  };

  const refresh = async () => {
    if (typeof props.bridge.refresh !== 'function') return;
    await props.bridge.refresh({ source: 'debug', message: 'refresh' });
  };

  const copy = async (text: string) => {
    const t = text ?? '';
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t).catch(() => {});
      return;
    }
    const el = document.createElement('textarea');
    el.value = t;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.append(el);
    el.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore
    } finally {
      el.remove();
    }
  };

  return (
    <div ref={rootRef} className={['grid h-full min-h-0 gap-3', showTwoCols ? 'grid-cols-2' : ''].join(' ')}>
      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Actions</CardTitle>
            <CardDescription>Dispatch semantic actions (human/agent parity).</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              icon={<RefreshCw className="h-4 w-4 text-slate-100/90" />}
              label="Refresh snapshots"
              title="Ask the provider to refresh its state snapshot."
              onClick={() => void refresh()}
            />
          </div>
        </CardHeader>

        <div className="mt-3">
          <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-action-filter">
            Filter
          </label>
          <Input id="vacp-action-filter" className="mt-1" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search…" />
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20">
          <div className="p-1">
            {filtered.map((a) => {
              const active = a.name === (selected?.name ?? '');
              return (
                <button
                  key={a.name}
                  type="button"
                  className={[
                    'w-full rounded-lg px-2 py-2 text-left text-xs transition-colors',
                    'hover:bg-white/5',
                    active ? 'border border-sky-300/30 bg-sky-500/10' : 'border border-transparent',
                  ].join(' ')}
                  aria-selected={active ? 'true' : 'false'}
                  onClick={() => setSelectedName(a.name)}
                >
                  <div className="font-semibold text-slate-100/90">{a.name}</div>
                  {a.description ? <div className="mt-1 text-[11px] text-slate-100/70">{a.description}</div> : null}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>{selected ? selected.name : 'Select an action'}</CardTitle>
            <CardDescription>{selected?.description ?? ''}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              icon={<Play className="h-4 w-4 text-slate-100/90" />}
              label="Run action"
              title="Execute this action with the current JSON params."
              variant="primary"
              onClick={() => void run()}
            />
            <IconButton
              icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
              label="Copy result"
              title="Copy the last result JSON to clipboard."
              onClick={() => void copy(safeJson(result))}
            />
          </div>
        </CardHeader>

        <div className="grid min-h-0 flex-1 gap-3">
          <div>
            <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-action-params">
              Params (JSON)
            </label>
            <Textarea
              id="vacp-action-params"
              className="mt-1 min-h-[140px]"
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
            />
          </div>

          <div className="min-h-0">
            <label className="text-[11px] font-medium text-slate-100/70">Result</label>
            <pre className="mt-1 min-h-0 max-h-[360px] overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/85">
              {status === 'running' ? 'Running…' : status === 'error' ? error ?? 'Action failed' : safeJson(result)}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
