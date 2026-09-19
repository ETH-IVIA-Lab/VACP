import { toJSONSchema, safeParseAsync, type $ZodIssue, type $ZodType, type output } from 'zod/v4/core';
import { VacpActionError } from '@vacp/protocol';
import type {
  VacpActionDescriptor,
  VacpOperationKind,
  VacpOperationResultDescriptor,
  VacpRef,
  VacpFocus,
  VacpSourceId,
} from '@vacp/protocol';
import {
  registerVacpApplyStateAction,
  type VacpApplyStatePreparation,
  registerVacpDataSchemaAction,
  type VacpDataSchemaHandler,
  registerVacpDataSqlAction,
  type VacpDataSqlHandler,
  registerVacpWidgetOptionsAction,
  type VacpWidgetOptionsHandler,
  VacpActionRegistry,
  type VacpActionHandler,
} from '@vacp/runtime';

export type VacpActions = {
  registry: VacpActionRegistry;
  operation: (kind: VacpOperationKind, name: string, description: string) => VacpActionBuilder;
  standard: {
    applyState: <Result>(
      prepare: VacpApplyStatePreparation<Result>,
      options?: Parameters<typeof registerVacpApplyStateAction>[2],
    ) => VacpActionDescriptor;
    dataSchema: (
      handler: VacpDataSchemaHandler,
      options?: Parameters<typeof registerVacpDataSchemaAction>[2],
    ) => VacpActionDescriptor;
    dataSql: (
      handler: VacpDataSqlHandler,
      options?: Parameters<typeof registerVacpDataSqlAction>[2],
    ) => VacpActionDescriptor | null;
    widgetOptions: (
      handler: VacpWidgetOptionsHandler,
      options?: Parameters<typeof registerVacpWidgetOptionsAction>[2],
    ) => VacpActionDescriptor;
  };
};

export function createVacpActions(sourceId?: VacpSourceId): VacpActions {
  const registry = new VacpActionRegistry(sourceId);

  return {
    registry,
    operation: (kind, name, description) =>
      new ActionDefinition(registry, { name, description, operation: { kind } }, (value) => value),
    standard: {
      applyState: (prepare, options) => registerVacpApplyStateAction(registry, prepare, options),
      dataSchema: (handler, options) => registerVacpDataSchemaAction(registry, handler, options),
      dataSql: (handler, options) => registerVacpDataSqlAction(registry, handler, options),
      widgetOptions: (handler, options) => registerVacpWidgetOptionsAction(registry, handler, options),
    },
  };
}

type VacpActionMetadata<Next> = {
  title(title: string): Next;
  contract(contract: string): Next;
  requires(...refs: VacpRef[]): Next;
  input(ref: VacpRef): Next;
  affects(ref: VacpRef): Next;
  produces(result: VacpOperationResultDescriptor): Next;
};

type ParameterIssue = {
  path: (string | number)[];
  code: $ZodIssue['code'];
  message: string;
  errors?: ParameterIssue[][];
  issues?: ParameterIssue[];
};

function parameterIssue(issue: $ZodIssue): ParameterIssue {
  const diagnostic = {
    path: issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
    code: issue.code,
    message: issue.message,
  };
  if (issue.code === 'invalid_union') {
    return { ...diagnostic, errors: issue.errors.map((branch) => branch.map(parameterIssue)) };
  }
  if (issue.code === 'invalid_key' || issue.code === 'invalid_element') {
    return { ...diagnostic, issues: issue.issues.map(parameterIssue) };
  }
  return diagnostic;
}

/** Parsed parameters stay fixed once execution or presentation behavior is bound. */
export interface VacpActionDefinition<Params = unknown> extends VacpActionMetadata<VacpActionDefinition<Params>> {
  focus<Detail>(resolve: (params: Params) => VacpFocus<Detail> | undefined): VacpActionDefinition<Params>;
  handle<Result>(handler: VacpActionHandler<Params, Result>): VacpActionDescriptor;
}

/** Define a Zod input schema before binding callbacks that consume its parsed output. */
export interface VacpActionBuilder extends VacpActionMetadata<VacpActionBuilder> {
  params<Schema extends $ZodType>(schema: Schema): VacpActionDefinition<output<Schema>>;
  focus<Detail>(resolve: (params: unknown) => VacpFocus<Detail> | undefined): VacpActionDefinition;
  handle<Result>(handler: VacpActionHandler<unknown, Result>): VacpActionDescriptor;
}

class ActionDefinition<Params = unknown> {
  private readonly registry: VacpActionRegistry;
  private readonly descriptor: VacpActionDescriptor;
  private focusTarget?: (params: Params) => VacpFocus | undefined;

  constructor(
    registry: VacpActionRegistry,
    descriptor: VacpActionDescriptor,
    private readonly parse: (value: unknown) => Params | Promise<Params>,
  ) {
    this.registry = registry;
    this.descriptor = descriptor;
  }

  title(title: string): this {
    this.descriptor.title = title;

    return this;
  }

  contract(contract: string): this {
    this.descriptor.operation.contract = contract;
    return this;
  }

  requires(...refs: VacpRef[]): this {
    this.descriptor.availability = {
      ...this.descriptor.availability,
      requires: [...new Set([...(this.descriptor.availability?.requires ?? []), ...refs])],
    };
    return this;
  }

  input(ref: VacpRef): this {
    this.descriptor.operation.inputRefs = [...(this.descriptor.operation.inputRefs ?? []), ref];

    return this;
  }

  affects(ref: VacpRef): this {
    this.descriptor.operation.affects = [...(this.descriptor.operation.affects ?? []), ref];

    return this;
  }

  produces(result: VacpOperationResultDescriptor): this {
    this.descriptor.operation.results = [...(this.descriptor.operation.results ?? []), result];

    return this;
  }

  params<Schema extends $ZodType>(schema: Schema): VacpActionDefinition<output<Schema>> {
    if (this.descriptor.parameters !== undefined || this.focusTarget)
      throw new Error('Define action parameters once, before focus');
    let parameters;
    try {
      parameters = toJSONSchema(schema, { io: 'input' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Cannot describe parameters for action "${this.descriptor.name}": ${message}`, { cause });
    }
    const descriptor = { ...structuredClone(this.descriptor), parameters };

    return new ActionDefinition(this.registry, descriptor, async (value) => {
      const parsed = await safeParseAsync(schema, value);
      if (!parsed.success) {
        throw new VacpActionError(`Invalid parameters for action "${descriptor.name}"`, {
          code: 'invalid-params',
          issues: parsed.error.issues.map(parameterIssue),
        });
      }
      return parsed.data;
    });
  }

  focus<Detail>(resolve: (params: Params) => VacpFocus<Detail> | undefined): this {
    this.focusTarget = resolve;
    return this;
  }

  handle<Result>(handler: VacpActionHandler<Params, Result>): VacpActionDescriptor {
    return this.registry.register(this.descriptor, handler, { parse: this.parse, focus: this.focusTarget });
  }
}
