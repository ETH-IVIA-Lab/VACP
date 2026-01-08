import type { VacpHistoryEntry, VacpRuntimeMode } from '@vacp/core';
import { Eye, EyeOff, Redo2, Rewind, Undo2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

import { IconButton } from '../icon-button';

import type { VacpDebugModuleProps } from './module-types';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}

export function HistoryModule(props: VacpDebugModuleProps): ReactElement {
  const history = props.runtime.history ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(history.at(-1)?.id ?? null);
  const selected = useMemo(() => history.find((h) => h.id === selectedId) ?? null, [history, selectedId]);

  const setMode = (mode: VacpRuntimeMode) => props.bridge.setMode?.(mode, { source: 'debug', message: `mode=${mode}` });
  const setCursor = (cursor: number) => props.bridge.setCursor?.(cursor, { source: 'debug', message: `cursor=${cursor}` });
  const undo = () => props.bridge.undo?.({ source: 'debug', message: 'undo' });
  const redo = () => props.bridge.redo?.({ source: 'debug', message: 'redo' });

  return (
    <div className="vacp-debug-ui-page">
      <div className="vacp-debug-ui-grid vacp-debug-ui-grid-1fr-360" style={{ height: '100%' }}>
        <section className="vacp-debug-ui-card" style={{ display: 'grid', gridTemplateRows: 'auto 1fr' }}>
          <div className="vacp-debug-ui-card-header">
            <div>
              <div className="vacp-debug-ui-card-title">History</div>
              <div className="vacp-debug-ui-card-subtitle">Time travel: inspect snapshots and action results.</div>
            </div>
            <div className="vacp-debug-ui-toolbar">
              <IconButton
                icon={<Eye className="vacp-debug-ui-icon" size={16} />}
                label="Live"
                title="Switch to live mode."
                pressed={props.runtime.mode === 'live'}
                onClick={() => setMode('live')}
              />
              <IconButton
                icon={<EyeOff className="vacp-debug-ui-icon" size={16} />}
                label="Inspect"
                title="Switch to inspect mode (time travel)."
                pressed={props.runtime.mode === 'inspect'}
                onClick={() => setMode('inspect')}
              />
              <IconButton icon={<Undo2 className="vacp-debug-ui-icon" size={16} />} label="Undo" title="Undo." onClick={() => undo()} />
              <IconButton icon={<Redo2 className="vacp-debug-ui-icon" size={16} />} label="Redo" title="Redo." onClick={() => redo()} />
            </div>
          </div>

          <div className="vacp-debug-ui-scroll" style={{ maxHeight: 560 }}>
            <div className="vacp-debug-ui-list">
              {history.map((h, i) => (
                <div
                  key={h.id}
                  className="vacp-debug-ui-row"
                  aria-selected={h.id === selectedId ? 'true' : 'false'}
                  data-role={h.source}
                  onClick={() => setSelectedId(h.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="vacp-debug-ui-role-dot" data-role={h.source} />
                    <div style={{ fontWeight: 650 }}>{h.kind}</div>
                    <div className="vacp-debug-ui-small" style={{ opacity: 0.8 }}>
                      {formatTime(h.at)}
                    </div>
                    <div style={{ flex: '1 1 auto' }} />
                    <IconButton
                      icon={<Rewind className="vacp-debug-ui-icon" size={16} />}
                      label="Rewind to here"
                      title="Set the cursor to this entry (inspect mode)."
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setMode('inspect');
                        setCursor(i);
                      }}
                    />
                  </div>
                  {h.message ? (
                    <div className="vacp-debug-ui-small" style={{ marginTop: 6 }}>
                      {h.message}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="vacp-debug-ui-card" style={{ display: 'grid', gridTemplateRows: 'auto 1fr' }}>
          <div className="vacp-debug-ui-card-header">
            <div>
              <div className="vacp-debug-ui-card-title">Details</div>
              <div className="vacp-debug-ui-card-subtitle">
                {selected ? `${selected.kind} • ${selected.source}` : 'Select an entry to inspect.'}
              </div>
            </div>
          </div>
          <pre className="vacp-debug-ui-code" style={{ minHeight: 0, whiteSpace: 'pre-wrap' }}>
            {safeJson(selected)}
          </pre>
        </section>
      </div>
    </div>
  );
}
