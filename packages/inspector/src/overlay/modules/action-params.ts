import {
  VACP_APPLY_STATE_ACTION,
  VACP_DATA_SCHEMA_ACTION,
  VACP_DATA_SQL_ACTION,
  VACP_WIDGET_OPTIONS_ACTION,
  type VacpActionDescriptor,
} from '@vacp/protocol';

type StateMap = Record<string, unknown>;

export type ActionParamIssue = {
  path: string;
  message: string;
};

export type ActionParamDraft = {
  params: unknown;
  summary: string;
};

type StateEntry = {
  ref: string;
  value: Record<string, unknown>;
};

type JsonSchemaObject = {
  type?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
  default?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function schemaObject(value: unknown): JsonSchemaObject | null {
  return isRecord(value) ? value : null;
}

function stateEntries(state: StateMap): StateEntry[] {
  return Object.entries(state)
    .filter(([, value]) => isRecord(value))
    .map(([ref, value]) => ({ ref, value: value as Record<string, unknown> }));
}

function firstStateEntry(state: StateMap, predicate: (entry: StateEntry) => boolean): StateEntry | null {
  return stateEntries(state).find(predicate) ?? null;
}

function firstKind(state: StateMap, kind: string): StateEntry | null {
  return firstStateEntry(state, (entry) => entry.value.kind === kind);
}

function firstWidget(state: StateMap, preferOptions = false): StateEntry | null {
  const preferred = firstStateEntry(
    state,
    (entry) =>
      entry.value.kind === 'Widget' &&
      (!preferOptions || (typeof entry.value.optionCount === 'number' && entry.value.optionCount > 0)),
  );

  if (preferred || preferOptions) return preferred;

  return firstKind(state, 'Widget');
}

function firstDataHandle(state: StateMap): StateEntry | null {
  return firstKind(state, 'DataHandle');
}

function schemaDefault(prop: unknown) {
  const schema = schemaObject(prop);

  if (!schema) return undefined;

  if (Object.hasOwn(schema, 'default')) return schema.default;

  if (schema.type === 'boolean') return false;

  if (schema.type === 'object') return {};

  return undefined;
}

function schemaTypes(prop: JsonSchemaObject | null): string[] {
  if (!prop) return [];

  if (typeof prop.type === 'string') return [prop.type];

  if (Array.isArray(prop.type)) return prop.type.filter((item): item is string => typeof item === 'string');

  return [];
}

function schemaRootDefault(action: VacpActionDescriptor): ActionParamDraft | null {
  const schema = schemaObject(action.parameters);

  if (!schema || !Object.hasOwn(schema, 'default')) return null;

  return {
    params: schema.default,
    summary: 'Seeded params from the action descriptor default.',
  };
}

function genericSchemaDraft(action: VacpActionDescriptor): ActionParamDraft {
  const rootDefault = schemaRootDefault(action);

  if (rootDefault) return rootDefault;
  const schema = schemaObject(action.parameters);

  const properties =
    schemaObject(schema?.properties)?.properties ?? (isRecord(schema?.properties) ? schema?.properties : {});

  const required = Array.isArray(schema?.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : [];

  const params: Record<string, unknown> = {};
  let seeded = 0;

  for (const key of required) {
    const value = schemaDefault(properties?.[key]);

    if (value === undefined) continue;
    params[key] = value;
    seeded += 1;
  }

  return {
    params,
    summary: required.length
      ? `Seeded ${seeded} of ${required.length} required field(s) from the parameter schema.`
      : 'No required params.',
  };
}

export function createActionParamDraft(action: VacpActionDescriptor, state: StateMap): ActionParamDraft {
  const rootDefault = schemaRootDefault(action);

  if (rootDefault) return rootDefault;

  const widget = firstWidget(state, action.name === VACP_WIDGET_OPTIONS_ACTION);
  const dataHandle = firstDataHandle(state);

  if (action.name === VACP_WIDGET_OPTIONS_ACTION && widget) {
    return {
      params: { ref: widget.ref, limit: 20 },
      summary: 'Seeded the first widget ref and a bounded option count.',
    };
  }

  if (action.name === VACP_APPLY_STATE_ACTION) {
    return { params: { state }, summary: 'Seeded the current state map.' };
  }

  if (action.name === VACP_DATA_SQL_ACTION && dataHandle) {
    return {
      params: {
        handleRef: dataHandle.ref,
        sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle',
        maxRows: 10,
      },
      summary: 'Seeded the first DataHandle and a count query.',
    };
  }

  if (action.name === VACP_DATA_SCHEMA_ACTION && dataHandle) {
    return { params: { handleRef: dataHandle.ref, detail: 'columns' }, summary: 'Seeded the first DataHandle.' };
  }

  return genericSchemaDraft(action);
}

export function validateActionParams(action: VacpActionDescriptor, params: unknown): ActionParamIssue[] {
  const issues: ActionParamIssue[] = [];
  const schema = schemaObject(action.parameters);

  if (!schema || schema.type !== 'object') return issues;

  if (!isRecord(params)) return [{ path: '$', message: 'Params must be a JSON object.' }];

  const properties = isRecord(schema.properties) ? schema.properties : {};

  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : [];

  const requiredSet = new Set(required);

  for (const [key, rawProp] of Object.entries(properties)) {
    const prop = schemaObject(properties[key]);
    const value = params[key];
    const present = Object.hasOwn(params, key) && value !== undefined && value !== null;

    if (!present) {
      if (requiredSet.has(key)) issues.push({ path: key, message: 'Required parameter is missing.' });
      continue;
    }

    const types = schemaTypes(prop ?? schemaObject(rawProp));

    if (types.length === 0) continue;

    const valid = types.some((type) => {
      if (type === 'string') return typeof value === 'string' && value.trim() !== '';

      if (type === 'number') return typeof value === 'number' && Number.isFinite(value);

      if (type === 'boolean') return typeof value === 'boolean';

      if (type === 'object') return isRecord(value);

      if (type === 'array') return Array.isArray(value);

      return true;
    });

    if (!valid) {
      issues.push({ path: key, message: `Expected ${types.join(' or ')}.` });
    }
  }

  for (const key of required) {
    if (Object.hasOwn(properties, key)) continue;
    const value = params[key];

    if (!Object.hasOwn(params, key) || value === undefined || value === null) {
      issues.push({ path: key, message: 'Required parameter is missing.' });
    }
  }

  return issues;
}
