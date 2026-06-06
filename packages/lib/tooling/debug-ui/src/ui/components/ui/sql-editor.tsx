import { acceptCompletion, completionStatus, startCompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, insertTab, history } from '@codemirror/commands';
import type { SQLNamespace } from '@codemirror/lang-sql';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import CodeMirror, { type Extension, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import type { KeyboardEventHandler } from 'react';
import { forwardRef, useEffect, useMemo, useState } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

export type SqlEditorProps = {
  id?: string;
  'data-vacp-focus'?: string;
  className?: string;
  value: string;
  readOnly?: boolean;
  placeholder?: string;
  height?: string;
  autoFocus?: boolean;
  schema?: SQLNamespace;
  resizable?: boolean;
  onChange?: (value: string) => void;
  onRun?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

const DEFAULT_LINE_HEIGHT_PX = 20;
const DEFAULT_ROWS = 10;
const DEFAULT_HEIGHT_PX = DEFAULT_ROWS * DEFAULT_LINE_HEIGHT_PX + 16;
const MIN_HEIGHT_PX = 6 * DEFAULT_LINE_HEIGHT_PX + 16;
const MAX_HEIGHT_PX = 26 * DEFAULT_LINE_HEIGHT_PX + 16;

const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'rgba(11, 17, 21, 0.72)',
    borderRadius: '0.5rem',
    border: '1px solid rgba(255,255,255,0.075)',
    overflow: 'hidden',
    outline: 'none',
    color: 'rgba(226, 232, 240, 0.88)',
    position: 'relative',
    zIndex: 0,
  },
  '.cm-gutters': {
    backgroundColor: 'rgba(7, 11, 14, 0.5)',
    color: 'rgba(226, 232, 240, 0.34)',
    borderRight: '1px solid rgba(255,255,255,0.055)',
    borderTopLeftRadius: '0.5rem',
    borderBottomLeftRadius: '0.5rem',
    overflow: 'hidden',
    zIndex: 1,
  },
  '.cm-gutterElement': {
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    caretColor: 'rgba(226, 232, 240, 0.9)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'rgba(226, 232, 240, 0.7)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(110, 231, 183, 0.16) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(110, 231, 183, 0.2) !important',
  },
  '.cm-scroller': {
    backgroundColor: 'rgba(11, 17, 21, 0.72)',
    overflow: 'auto',
    borderRadius: '0.5rem',
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: '12px',
    lineHeight: '20px',
  },
  '&.cm-focused': {
    boxShadow: 'inset 0 0 0 2px rgba(110, 231, 183, 0.22)',
  },
  '.cm-tooltip': {
    border: '1px solid rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(9, 14, 18, 0.96)',
    color: 'rgba(226, 232, 240, 0.9)',
    boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 10px',
    fontSize: '12px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(110, 231, 183, 0.14)',
    color: 'rgba(226, 232, 240, 0.98)',
  },
});

export const SqlEditor = forwardRef<ReactCodeMirrorRef, SqlEditorProps>(
  (
    {
      id,
      className,
      value,
      onChange,
      onRun,
      onKeyDown,
      readOnly,
      schema,
      placeholder,
      height = `${DEFAULT_HEIGHT_PX}px`,
      autoFocus = true,
      resizable,
      'data-vacp-focus': dataVacpFocus,
    },
    ref,
  ) => {
    const [editorHeight, setEditorHeight] = useState(height);
    useEffect(() => setEditorHeight(height), [height]);

    const extensions = useMemo(() => {
      const enableCompletion = !readOnly;
      const enableRun = !readOnly && typeof onRun === 'function';

      const bindings: KeyBinding[] = [
        ...(enableCompletion
          ? ([
              {
                key: 'Tab',
                run: (target) => {
                  if (completionStatus(target.state) === 'active') {
                    acceptCompletion(target);
                    return true;
                  }
                  return insertTab(target);
                },
              },
              {
                key: 'Ctrl-Space',
                mac: 'Cmd-Space',
                preventDefault: true,
                run: startCompletion,
              },
              // Add completion keymap but filter out Tab since we handle it above.
              ...completionKeymap.filter((binding) => !(binding.key || '').includes('Tab')),
            ] as KeyBinding[])
          : []),
        ...(enableRun
          ? ([
              {
                key: 'Ctrl-Enter',
                mac: 'Cmd-Enter',
                preventDefault: true,
                run: () => {
                  onRun?.();
                  return true;
                },
              },
            ] as KeyBinding[])
          : []),
        ...(!readOnly ? defaultKeymap : []),
      ];

      return [
        history(),
        Prec.highest(keymap.of(bindings)),
        sql({ dialect: PostgreSQL, upperCaseKeywords: true, schema }),
        dataVacpFocus ? EditorView.contentAttributes.of({ 'data-vacp-focus': dataVacpFocus }) : null,
        placeholder ? EditorView.contentAttributes.of({ 'aria-label': placeholder }) : null,
      ].filter(Boolean) as Extension[];
    }, [readOnly, onRun, schema, placeholder, dataVacpFocus]);

    const enableResize = (resizable ?? !readOnly) && typeof window !== 'undefined';

    return (
      <div className={cn('relative z-0 w-full', className)}>
        <CodeMirror
          ref={ref}
          autoFocus={autoFocus}
          theme={[oneDark, baseTheme]}
          readOnly={readOnly}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          basicSetup={{
            // Preserve Tab behavior via our own keymap.
            defaultKeymap: false,
            lineNumbers: true,
            highlightActiveLine: true,
            foldGutter: false,
          }}
          className="w-full"
          id={id}
          height={editorHeight}
          extensions={extensions}
        />

        {enableResize ? (
          <button
            type="button"
            aria-label="Resize SQL editor"
            className="absolute bottom-2 right-2 z-10 h-4 w-4 cursor-nwse-resize rounded-sm border border-white/[0.08] bg-black/16 text-slate-100/50 opacity-55 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/35"
            onMouseDown={(ev) => {
              ev.preventDefault();
              const startY = ev.clientY;
              const start = Number.parseFloat(editorHeight) || DEFAULT_HEIGHT_PX;
              const onMove = (moveEv: MouseEvent) => {
                const next = Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, start + (moveEv.clientY - startY)));
                setEditorHeight(`${Math.round(next)}px`);
              };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M6 14h8M8 16h6M10 18h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
    );
  },
);

SqlEditor.displayName = 'SqlEditor';
