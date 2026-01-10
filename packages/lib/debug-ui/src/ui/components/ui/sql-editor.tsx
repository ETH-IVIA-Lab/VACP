import { acceptCompletion, completionStatus, startCompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, insertTab, history } from '@codemirror/commands';
import type { SQLNamespace } from '@codemirror/lang-sql';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import CodeMirror, { type Extension, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import type { KeyboardEventHandler } from 'react';
import { forwardRef, useMemo } from 'react';

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
  onChange?: (value: string) => void;
  onRun?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'rgba(2, 6, 23, 0.55)', // slate-950-ish
    borderRadius: '0.5rem',
    border: '1px solid rgba(255,255,255,0.10)',
    outline: 'none',
    color: 'rgba(226, 232, 240, 0.92)',
    position: 'relative',
    zIndex: 0,
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'rgba(226, 232, 240, 0.45)', // slate-200
    borderRight: '1px solid rgba(255,255,255,0.08)',
  },
  '.cm-content': {
    caretColor: 'rgba(226, 232, 240, 0.9)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'rgba(226, 232, 240, 0.7)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(56, 189, 248, 0.18) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(56, 189, 248, 0.22) !important',
  },
  '.cm-scroller': {
    backgroundColor: 'transparent',
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: '12px',
    lineHeight: '20px',
  },
  '&.cm-focused': {
    boxShadow: 'inset 0 0 0 2px rgba(56, 189, 248, 0.35)',
  },
  '.cm-tooltip': {
    border: '1px solid rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(2, 6, 23, 0.96)',
    color: 'rgba(226, 232, 240, 0.92)',
    boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 10px',
    fontSize: '12px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
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
      height = '220px',
      autoFocus = true,
      'data-vacp-focus': dataVacpFocus,
    },
    ref,
  ) => {
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
        oneDark,
        baseTheme,
        dataVacpFocus ? EditorView.contentAttributes.of({ 'data-vacp-focus': dataVacpFocus }) : null,
        placeholder ? EditorView.contentAttributes.of({ 'aria-label': placeholder }) : null,
      ].filter(Boolean) as Extension[];
    }, [readOnly, onRun, schema, placeholder, dataVacpFocus]);

    return (
      <CodeMirror
        ref={ref}
        autoFocus={autoFocus}
        theme="dark"
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
        className={cn('relative z-0 w-full', className)}
        id={id}
        height={height}
        extensions={extensions}
      />
    );
  },
);

SqlEditor.displayName = 'SqlEditor';
