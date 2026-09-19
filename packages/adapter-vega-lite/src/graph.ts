import type { VacpActionDescriptor, VacpEdge, VacpGraphFragment, VacpNode, VacpRef } from '@vacp/protocol';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';

import type { VegaLiteBindings } from './bindings';
import { makeRef } from './refs';
import type { VegaLiteProviderOptions, VegaLiteParamLike, VegaLiteSpecLike } from './types';

function classifyParam(p: VegaLiteParamLike): { kind: 'Param' | 'Selection'; details: Record<string, unknown> } {
  if (p.select) {
    return { kind: 'Selection', details: { select: p.select, bind: p.bind } };
  }

  return { kind: 'Param', details: { bind: p.bind } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function markTypeFromSpec(spec: VegaLiteSpecLike, inherited?: string): string | undefined {
  const mark = spec.mark;

  if (typeof mark === 'string' && mark) return mark;

  if (isRecord(mark) && typeof mark.type === 'string' && mark.type.length) return mark.type;

  return inherited;
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const walk = (v: unknown): unknown => {
    if (v == null) return v;

    if (typeof v === 'function' || typeof v === 'symbol') return undefined;

    if (typeof v !== 'object') return v;
    const obj = v;

    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    if (Array.isArray(v)) return v.map(walk);
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.keys(rec)
      .sort()
      .forEach((k) => {
        out[k] = walk(rec[k]);
      });

    return out;
  };

  return JSON.stringify(walk(value)) ?? 'null';
}

function safeJsonValue(value: unknown) {
  try {
    return JSON.parse(stableStringify(value));
  } catch {
    return String(value);
  }
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fieldNameFromDescriptor(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length) return raw;

  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const field = rec.field;

  return typeof field === 'string' && field.length ? field : null;
}

type VegaLiteUnit = {
  spec: VegaLiteSpecLike;
  path: string;
  markType?: string;
};

function collectVegaLiteUnits(spec: VegaLiteSpecLike): VegaLiteUnit[] {
  const units: VegaLiteUnit[] = [];

  const walk = (next: unknown, path: string[], inheritedMark?: string): void => {
    if (!isRecord(next)) return;
    const s = next;
    const markType = markTypeFromSpec(s, inheritedMark);

    if (isRecord(s.encoding)) {
      units.push({ spec: s, path: path.join('/'), markType });
    }

    const pushChildren = (key: 'layer' | 'hconcat' | 'vconcat' | 'concat') => {
      const child = s[key];

      if (!Array.isArray(child)) return;
      child.forEach((c, i) => walk(c, [...path, `${key}[${i}]`], markType));
    };

    pushChildren('layer');
    pushChildren('hconcat');
    pushChildren('vconcat');
    pushChildren('concat');

    if (s.spec) walk(s.spec, [...path, 'spec'], markType);
  };

  walk(spec, ['root']);

  return units;
}

type ExtractedBinding = {
  channel: string;
  bindingKind: 'primary' | 'condition' | 'tooltip';
  bindingIndex: number;
  descriptor: unknown;
  fieldName: string | null;
};

function collectChannelBindings(spec: VegaLiteSpecLike): ExtractedBinding[] {
  if (!isRecord(spec.encoding)) return [];
  const encoding = spec.encoding;
  const out: ExtractedBinding[] = [];

  const push = (args: {
    channel: string;
    bindingKind: 'primary' | 'condition' | 'tooltip';
    bindingIndex: number;
    descriptor: unknown;
  }) => {
    const fieldName = fieldNameFromDescriptor(args.descriptor);

    if (!fieldName) return;
    out.push({
      channel: args.channel,
      bindingKind: args.bindingKind,
      bindingIndex: args.bindingIndex,
      descriptor: args.descriptor,
      fieldName,
    });
  };

  Object.entries(encoding).forEach(([channel, def]) => {
    if (channel === 'tooltip') {
      if (typeof def === 'string') {
        push({ channel, bindingKind: 'tooltip', bindingIndex: 0, descriptor: def });

        return;
      }

      if (Array.isArray(def)) {
        def.forEach((entry, i) => push({ channel, bindingKind: 'tooltip', bindingIndex: i, descriptor: entry }));

        return;
      }

      push({ channel, bindingKind: 'tooltip', bindingIndex: 0, descriptor: def });

      return;
    }

    if (!isRecord(def)) return;
    push({ channel, bindingKind: 'primary', bindingIndex: 0, descriptor: def });

    const cond = def.condition;

    if (isRecord(cond)) {
      push({ channel, bindingKind: 'condition', bindingIndex: 0, descriptor: cond });

      return;
    }

    if (Array.isArray(cond)) {
      cond.forEach((entry, i) => push({ channel, bindingKind: 'condition', bindingIndex: i, descriptor: entry }));
    }
  });

  return out;
}

export function buildGraph(args: {
  bindings: VegaLiteBindings;
  spec: VegaLiteSpecLike;
  options: VegaLiteProviderOptions;
  actions: VacpActionDescriptor[];
  dataHandles?: Array<{ ref: VacpRef; title?: string; description?: string; data?: Record<string, unknown> }>;
}): VacpGraphFragment {
  const vizRef = makeRef({
    appId: args.options.appId,
    viewId: args.options.viewId,
    vizId: args.options.vizId,
    suffix: '',
  });

  const nodes: VacpNode[] = [
    {
      ref: vizRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: args.options.title,
      description: args.options.description,
      data: { provider: 'vega-lite' },
    },
  ];

  const edges: VacpEdge[] = [];

  collectVegaLiteUnits(args.spec).forEach((unit) => {
    const bindings = collectChannelBindings(unit.spec);

    if (!bindings.length) return;

    const markRef = makeRef({
      appId: args.options.appId,
      viewId: args.options.viewId,
      vizId: args.options.vizId,
      suffix: `/mark/${encodeURIComponent(unit.path)}`,
    });

    nodes.push({
      ref: markRef,
      kind: 'Mark',
      layer: 'VisualizationLayer',
      title: unit.markType ?? 'unit',
      description: `Vega-Lite unit mark (${unit.path})`,
      data: { unitPath: unit.path, markType: unit.markType },
    });
    edges.push({ from: vizRef, to: markRef, kind: 'contains' });

    const byChannel = new Map<string, ExtractedBinding[]>();
    bindings.forEach((b) => {
      const list = byChannel.get(b.channel) ?? [];
      list.push(b);
      byChannel.set(b.channel, list);
    });

    Array.from(byChannel.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([channel, channelBindings]) => {
        const channelRef = makeRef({
          appId: args.options.appId,
          viewId: args.options.viewId,
          vizId: args.options.vizId,
          suffix: `/mark/${encodeURIComponent(unit.path)}/encoding/${encodeURIComponent(channel)}`,
        });

        nodes.push({
          ref: channelRef,
          kind: 'EncodingChannel',
          layer: 'VisualizationLayer',
          title: channel,
          description: `Vega-Lite encoding channel "${channel}"`,
          data: {
            unitPath: unit.path,
            channel,
            markType: unit.markType,
            bindingCount: channelBindings.length,
          },
        });
        edges.push({ from: markRef, to: channelRef, kind: 'contains' });

        channelBindings.forEach((binding) => {
          const hashInput = (() => {
            try {
              return stableStringify(binding.descriptor);
            } catch {
              return String(binding.descriptor);
            }
          })();

          const fieldId = binding.fieldName
            ? `field-${encodeURIComponent(binding.fieldName)}`
            : `field-${fnv1a32(hashInput)}`;

          const fieldRef = makeRef({
            appId: args.options.appId,
            viewId: args.options.viewId,
            vizId: args.options.vizId,
            suffix: `/mark/${encodeURIComponent(unit.path)}/encoding/${encodeURIComponent(channel)}/field/${binding.bindingKind}-${binding.bindingIndex}-${fieldId}`,
          });

          const descriptor = isRecord(binding.descriptor) ? binding.descriptor : null;

          nodes.push({
            ref: fieldRef,
            kind: 'EncodedField',
            layer: 'DataLayer',
            title: binding.fieldName ?? `field (${fieldId.replace(/^field-/, '')})`,
            description: `Field binding for "${channel}" (${binding.bindingKind}).`,
            data: {
              unitPath: unit.path,
              markType: unit.markType,
              channel,
              bindingKind: binding.bindingKind,
              bindingIndex: binding.bindingIndex,
              fieldName: binding.fieldName ?? undefined,
              field: safeJsonValue(binding.descriptor),
              type: typeof descriptor?.type === 'string' ? descriptor.type : undefined,
              aggregate: typeof descriptor?.aggregate === 'string' ? descriptor.aggregate : undefined,
              timeUnit: typeof descriptor?.timeUnit === 'string' ? descriptor.timeUnit : undefined,
              bin: descriptor && 'bin' in descriptor ? safeJsonValue(descriptor.bin) : undefined,
              title: typeof descriptor?.title === 'string' ? descriptor.title : undefined,
            },
          });
          edges.push({ from: channelRef, to: fieldRef, kind: 'contains' });
        });
      });
  });

  args.bindings.paramByRef.forEach(({ param: p }, pref) => {
    const { kind, details } = classifyParam(p);

    nodes.push({
      ref: pref,
      kind,
      layer: kind === 'Selection' ? 'InteractionFeedbackLayer' : 'ConfigLayer',
      title: p.name,
      description: kind === 'Selection' ? 'Vega-Lite selection parameter' : 'Vega-Lite variable parameter',
      data: details,
    });
    edges.push({ from: vizRef, to: pref, kind: 'contains' });
  });

  (args.dataHandles ?? []).forEach((h) => {
    nodes.push({
      ref: h.ref,
      kind: 'DataHandle',
      layer: 'DataLayer',
      title: h.title ?? 'data (DuckDB handle)',
      description:
        h.description ??
        'DuckDB-backed DataHandle for this Vega-Lite view. `vacp_handle` is the selected subset (or all rows if empty).',
      data: h.data,
    });
    edges.push({ from: vizRef, to: h.ref, kind: 'contains' });
  });

  return { version: VACP_SCHEMA_VERSION, nodes, edges, actions: args.actions };
}
