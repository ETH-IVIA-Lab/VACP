import JsonView from '@uiw/react-json-view';
import JsonViewEditor from '@uiw/react-json-view/editor';
import { Braces, Check, ClipboardCopy, Code2, Plus, Trash2 } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@vacp/inspector/ui/components/ui/button';
import { Input } from '@vacp/inspector/ui/components/ui/input';
import {
  deleteJsonPath,
  isJsonContainer,
  parseJsonEditorPath,
  parseJsonLiteral,
  renameJsonKey,
  setJsonPath,
  toJsonContainer,
  type JsonPath,
} from '@vacp/inspector/ui/components/ui/json-editor-model';
import { JsonInlineValueEditor, JsonKeyEditor, pathLabel } from '@vacp/inspector/ui/components/ui/json-editor-inline';
import { collapseDepthForExpandDepth, jsonViewTheme, stringifyJson } from '@vacp/inspector/ui/components/ui/json-theme';
import { Textarea } from '@vacp/inspector/ui/components/ui/textarea';
import { copyTextToClipboard } from '@vacp/inspector/ui/lib/clipboard';
import { cn } from '@vacp/inspector/ui/lib/utils';

type JsonEditorMode = 'tree' | 'raw';

type JsonTypeRenderResult = {
  type: 'type' | 'value';
  value?: unknown;
  keyName: string | number;
  keys?: JsonPath;
};

type JsonSectionRenderResult = {
  value?: unknown;
  parentValue?: unknown;
  keyName?: string | number;
  keys?: JsonPath;
};

type JsonRootPolicy = 'object' | 'container' | 'any';

type JsonEditorBaseProps = {
  id?: string;
  value: unknown;
  onChange: (value: unknown) => void;
  className?: string;
  disabled?: boolean;
  expandDepth?: number;
  minHeightClassName?: string;
  onValidityChange?: (error: string | null) => void;
  documentKey?: string;
  valueRevision?: string | number;
  labelledBy?: string;
};

export type JsonObjectEditorProps = JsonEditorBaseProps;

export type JsonValueEditorProps = JsonEditorBaseProps;

export function JsonObjectEditor(props: JsonObjectEditorProps): ReactElement {
  return <JsonEditorBase {...props} rootPolicy="object" />;
}

export function JsonValueEditor(props: JsonValueEditorProps): ReactElement {
  return <JsonEditorBase {...props} rootPolicy="any" />;
}

function JsonEditorBase({
  id,
  value,
  onChange,
  className,
  disabled,
  expandDepth = 2,
  minHeightClassName = 'min-h-[180px]',
  onValidityChange,
  documentKey,
  valueRevision,
  labelledBy,
  rootPolicy,
}: JsonEditorBaseProps & { rootPolicy: JsonRootPolicy }): ReactElement {
  const [mode, setMode] = useState<JsonEditorMode>('tree');
  const editorValue = normalizeRootValue(rootPolicy, value);
  const [rawText, setRawText] = useState(() => stringifyJson(editorValue));
  const [rawError, setRawError] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureStatus, setStructureStatus] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [pathText, setPathText] = useState('');
  const [pathValueText, setPathValueText] = useState('null');
  const lastRawSerialized = useRef<string | null>(null);
  const seenDocumentKey = useRef(documentKey);
  const seenValueRevision = useRef(valueRevision);
  const root = useMemo(() => normalizeRootValue(rootPolicy, value), [rootPolicy, value]);
  const containerRoot = useMemo(() => (isJsonContainer(root) ? root : null), [root]);
  const collapsed = useMemo(() => collapseDepthForExpandDepth(expandDepth), [expandDepth]);
  const serializedValue = useMemo(() => stringifyJson(root), [root]);
  const blockingError = mode === 'raw' ? rawError : treeError;

  useEffect(() => {
    onValidityChange?.(blockingError);
  }, [blockingError, onValidityChange]);

  useEffect(() => {
    if (mode === 'raw' && serializedValue === lastRawSerialized.current) return;
    setRawText(serializedValue);
    setRawError(null);
  }, [mode, serializedValue]);

  useEffect(() => {
    const documentChanged = !Object.is(seenDocumentKey.current, documentKey);
    const revisionChanged = !Object.is(seenValueRevision.current, valueRevision);

    if (!documentChanged && !revisionChanged) return;
    seenDocumentKey.current = documentKey;
    seenValueRevision.current = valueRevision;
    setRawText(serializedValue);
    setRawError(null);
    setTreeError(null);
    setStructureError(null);
    setStructureStatus(null);
    lastRawSerialized.current = serializedValue;
  }, [documentKey, serializedValue, valueRevision]);

  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(null), 1400);

    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const commitValue = useCallback(
    (path: JsonPath, nextValue: unknown) => {
      const nextRoot = setJsonPath(root, path, nextValue);
      onChange(nextRoot);
    },
    [onChange, root],
  );

  const renameKey = useCallback(
    (path: JsonPath, nextKey: string) => {
      const nextRoot = renameJsonKey(root, path, nextKey);
      onChange(nextRoot);
    },
    [onChange, root],
  );

  const deletePath = useCallback(
    (path: JsonPath) => {
      try {
        const nextRoot = deleteJsonPath(root, path);
        onChange(nextRoot);
        setTreeError(null);
      } catch (err) {
        setTreeError(String(err));
      }
    },
    [onChange, root],
  );

  const renderKey = useCallback(
    (nodeProps: Record<string, unknown>, result: JsonSectionRenderResult) => (
      <JsonKeyEditor
        children={nodeProps.children as ReactNode}
        path={result.keys ?? (typeof result.keyName === 'undefined' ? [] : [result.keyName])}
        keyName={result.keyName ?? ''}
        canRename={
          Boolean(result.parentValue) && typeof result.parentValue === 'object' && !Array.isArray(result.parentValue)
        }
        disabled={disabled}
        onRename={renameKey}
        onError={setTreeError}
      />
    ),
    [disabled, renameKey],
  );

  const renderValue = useCallback(
    (_nodeProps: Record<string, unknown>, result: JsonTypeRenderResult) => {
      if (result.type !== 'value') return null;

      return (
        <JsonInlineValueEditor
          value={result.value}
          path={result.keys ?? [result.keyName]}
          disabled={disabled}
          onCommit={commitValue}
          onError={setTreeError}
        />
      );
    },
    [commitValue, disabled],
  );

  const renderRow = useCallback(
    (nodeProps: Record<string, unknown>, result: JsonSectionRenderResult) => {
      const { children, className: _className, ...rest } = nodeProps;
      const path = result.keys ?? [];

      return (
        <div {...rest} className={cn('vacp-json-editor-row', _className as string | undefined)}>
          <span className="vacp-json-editor-row-content">{children as ReactNode}</span>
          {path.length > 0 && !disabled ? (
            <button
              type="button"
              className="vacp-json-editor-row-delete"
              aria-label={`Delete JSON path ${pathLabel(path)}`}
              onClick={(event) => {
                event.stopPropagation();
                deletePath(path);
              }}
            >
              <Trash2 aria-hidden="true" />
            </button>
          ) : null}
        </div>
      );
    },
    [deletePath, disabled],
  );

  const applyPathValue = () => {
    try {
      const path = parseJsonEditorPath(pathText);
      const parsed = parseJsonLiteral(pathValueText);
      const nextRoot = path.length === 0 && rootPolicy === 'any' ? parsed : setJsonPath(root, path, parsed);
      assertRootValue(rootPolicy, nextRoot);
      onChange(nextRoot);
      setTreeError(null);
      setStructureError(null);
      setStructureStatus(path.length === 0 ? 'Root replaced.' : `Set ${pathLabel(path)}.`);
    } catch (err) {
      setStructureStatus(null);
      setStructureError(String(err));
    }
  };

  const removePathValue = () => {
    try {
      const path = parseJsonEditorPath(pathText);
      const nextRoot = deleteJsonPath(root, path);
      onChange(nextRoot);
      setTreeError(null);
      setStructureError(null);
      setStructureStatus(`Deleted ${pathLabel(path)}.`);
    } catch (err) {
      setStructureStatus(null);
      setStructureError(String(err));
    }
  };

  const handleRawChange = (nextText: string) => {
    setRawText(nextText);

    try {
      const parsed = parseJsonLiteral(nextText);
      assertRootValue(rootPolicy, parsed);
      lastRawSerialized.current = stringifyJson(parsed);
      onChange(parsed);
      setRawError(null);
    } catch (err) {
      setRawError(String(err));
    }
  };

  const switchMode = (nextMode: JsonEditorMode) => {
    if (nextMode === mode) return;

    if (nextMode === 'raw') {
      setRawText(serializedValue);
      setRawError(null);
    } else {
      setTreeError(null);
    }

    setMode(nextMode);
  };

  return (
    <div
      id={id}
      className={cn(
        'vacp-json-editor flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-white/[0.075] bg-white/[0.022]',
        minHeightClassName,
        className,
      )}
      data-vacp-json-editor={id ?? 'json-editor'}
      data-vacp-json-editor-mode={mode}
      role="group"
      aria-labelledby={labelledBy}
    >
      <div className="vacp-json-editor-toolbar">
        <div className="vacp-json-editor-mode-group" role="group" aria-label="JSON editor mode">
          <Button
            type="button"
            size="sm"
            variant={mode === 'tree' ? 'primary' : 'ghost'}
            aria-pressed={mode === 'tree'}
            onClick={() => switchMode('tree')}
          >
            <Braces aria-hidden="true" />
            Tree
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'raw' ? 'primary' : 'ghost'}
            aria-pressed={mode === 'raw'}
            onClick={() => switchMode('raw')}
          >
            <Code2 aria-hidden="true" />
            Raw
          </Button>
        </div>
        <div className="vacp-json-editor-toolbar-actions">
          {copyStatus ? <span className="vacp-json-editor-copy-status">{copyStatus}</span> : null}
          <Button
            type="button"
            size="iconSm"
            variant="ghost"
            aria-label="Copy JSON"
            onClick={() => {
              void copyTextToClipboard(stringifyJson(root));
              setCopyStatus('Copied');
            }}
          >
            {copyStatus ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {mode === 'tree' ? (
        <div className="vacp-json-editor-tree-shell">
          {containerRoot ? (
            <div className="vacp-json-editor-tree-scroll">
              <JsonViewEditor
                className="vacp-json-viewer-tree vacp-json-editor-tree"
                value={containerRoot}
                style={jsonViewTheme}
                collapsed={collapsed}
                displayDataTypes={false}
                displayObjectSize={true}
                enableClipboard={true}
                highlightUpdates={false}
                indentWidth={12}
                editable={false}
                onCopied={() => setCopyStatus('Copied')}
              >
                <JsonView.KeyName render={renderKey} />
                <JsonView.Row render={renderRow} />
                <JsonView.String render={renderValue} />
                <JsonView.Int render={renderValue} />
                <JsonView.Float render={renderValue} />
                <JsonView.True render={renderValue} />
                <JsonView.False render={renderValue} />
                <JsonView.Null render={renderValue} />
              </JsonViewEditor>
            </div>
          ) : (
            <div className="vacp-json-editor-scalar-root">
              <div className="text-[12px] font-medium text-slate-100/78">Scalar JSON root</div>
              <div className="mt-1 text-[11px] leading-4 text-slate-100/58">Switch to Raw to edit this value.</div>
            </div>
          )}
          <div className="vacp-json-editor-structure">
            <Input
              className="vacp-json-editor-path-input"
              value={pathText}
              disabled={disabled}
              aria-label="JSON path"
              placeholder="/path or root key"
              onChange={(event) => setPathText(event.target.value)}
            />
            <Input
              className="vacp-json-editor-path-value"
              value={pathValueText}
              disabled={disabled}
              aria-label="JSON path value"
              placeholder="JSON value"
              onChange={(event) => setPathValueText(event.target.value)}
            />
            <Button type="button" size="sm" variant="primary" disabled={disabled} onClick={applyPathValue}>
              <Plus aria-hidden="true" />
              Set
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={disabled} onClick={removePathValue}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <Textarea
          className="vacp-json-editor-raw"
          value={rawText}
          disabled={disabled}
          spellCheck={false}
          data-vacp-json-editor-raw={id ?? 'json-editor'}
          aria-label={labelledBy ? undefined : 'Raw JSON'}
          aria-labelledby={labelledBy}
          onChange={(event) => handleRawChange(event.target.value)}
        />
      )}

      {blockingError ? (
        <div className="vacp-json-editor-error" role="alert" data-vacp-json-editor-error="validation">
          {blockingError}
        </div>
      ) : null}
      {structureError ? (
        <div className="vacp-json-editor-error" role="alert" data-vacp-json-editor-error="structure">
          {structureError}
        </div>
      ) : null}
      {structureStatus ? <div className="vacp-json-editor-status">{structureStatus}</div> : null}
    </div>
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRootValue(policy: JsonRootPolicy, value: unknown) {
  if (policy === 'any') return value;

  if (policy === 'object') return isJsonObject(value) ? value : {};

  return toJsonContainer(value);
}

function assertRootValue(policy: JsonRootPolicy, value: unknown): void {
  if (policy === 'any') return;

  if (policy === 'object') {
    if (!isJsonObject(value)) throw new Error('Expected a JSON object.');

    return;
  }

  if (!isJsonContainer(value)) throw new Error('Expected a JSON object or array.');
}
