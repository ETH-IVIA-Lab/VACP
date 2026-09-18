import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { formatJsonLiteral, parseJsonLiteral, type JsonPath } from '@vacp/inspector/ui/components/ui/json-editor-model';

function formatEditableLiteral(value: unknown): string {
  return formatJsonLiteral(value) ?? String(value);
}

function parseInlineValue(input: string, previousValue: unknown) {
  try {
    return parseJsonLiteral(input);
  } catch (err) {
    if (typeof previousValue === 'string') return input;
    throw err;
  }
}

export function pathLabel(path: JsonPath): string {
  if (path.length === 0) return 'root';

  return path.map((segment) => String(segment)).join('.');
}

export function JsonInlineValueEditor(props: {
  value: unknown;
  path: JsonPath;
  disabled?: boolean;
  onCommit: (path: JsonPath, value: unknown) => void;
  onError: (error: string | null) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatEditableLiteral(props.value));

  useEffect(() => {
    if (!editing) setDraft(formatEditableLiteral(props.value));
  }, [editing, props.value]);

  const commit = () => {
    try {
      props.onCommit(props.path, parseInlineValue(draft, props.value));
      props.onError(null);
      setEditing(false);
    } catch (err) {
      props.onError(`Invalid JSON value at ${pathLabel(props.path)}: ${String(err)}`);
    }
  };

  if (editing && !props.disabled) {
    return (
      <input
        className="vacp-json-editor-inline-input"
        value={draft}
        aria-label={`Edit JSON value at ${pathLabel(props.path)}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') commit();

          if (event.key === 'Escape') {
            setDraft(formatEditableLiteral(props.value));
            props.onError(null);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="vacp-json-editor-value"
      disabled={props.disabled}
      aria-label={`Edit JSON value at ${pathLabel(props.path)}`}
      onClick={(event) => {
        event.stopPropagation();

        if (!props.disabled) setEditing(true);
      }}
    >
      {formatEditableLiteral(props.value)}
    </button>
  );
}

export function JsonKeyEditor(props: {
  children: ReactNode;
  path: JsonPath;
  keyName: string | number;
  canRename: boolean;
  disabled?: boolean;
  onRename: (path: JsonPath, nextKey: string) => void;
  onError: (error: string | null) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => String(props.keyName));

  useEffect(() => {
    if (!editing) setDraft(String(props.keyName));
  }, [editing, props.keyName]);

  const commit = () => {
    try {
      props.onRename(props.path, draft);
      props.onError(null);
      setEditing(false);
    } catch (err) {
      props.onError(`Invalid JSON key at ${pathLabel(props.path)}: ${String(err)}`);
    }
  };

  if (!props.canRename || props.disabled) {
    return <span className="vacp-json-editor-key-readonly">{props.children}</span>;
  }

  if (editing) {
    return (
      <input
        className="vacp-json-editor-key-input"
        value={draft}
        aria-label={`Rename JSON key ${String(props.keyName)}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') commit();

          if (event.key === 'Escape') {
            setDraft(String(props.keyName));
            props.onError(null);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="vacp-json-editor-key"
      aria-label={`Rename JSON key ${String(props.keyName)}`}
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      {props.children}
    </button>
  );
}
