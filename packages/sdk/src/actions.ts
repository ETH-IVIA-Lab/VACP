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

/** A Zod schema or an application-owned parser. No schema generation is required. */
export type VacpActionParser<Params> = { parse: (value: unknown) => Params | Promise<Params> };

type VacpActionMetadata<Next> = {
  title(title: string): Next;
  contract(contract: string): Next;
  requires(...refs: VacpRef[]): Next;
  input(ref: VacpRef): Next;
  affects(ref: VacpRef): Next;
  produces(result: VacpOperationResultDescriptor): Next;
};

/** Parsed parameters stay fixed once execution or presentation behavior is bound. */
export interface VacpActionDefinition<Params = unknown> extends VacpActionMetadata<VacpActionDefinition<Params>> {
  focus<Detail>(resolve: (params: Params) => VacpFocus<Detail> | undefined): VacpActionDefinition<Params>;
  handle<Result>(handler: VacpActionHandler<Params, Result>): VacpActionDescriptor;
}

/** Describe parameters before binding callbacks that consume them. */
export interface VacpActionBuilder extends VacpActionMetadata<VacpActionBuilder> {
  params<Schema extends object>(schema: Schema): VacpActionDefinition;
  params<Input, Schema extends object>(schema: Schema, parser: VacpActionParser<Input>): VacpActionDefinition<Input>;
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

  params<Schema extends object>(schema: Schema): VacpActionDefinition;
  params<Input, Schema extends object>(schema: Schema, parser: VacpActionParser<Input>): VacpActionDefinition<Input>;
  params<Input, Schema extends object>(
    schema: Schema,
    parser?: VacpActionParser<Input>,
  ): VacpActionDefinition<Input> | VacpActionDefinition {
    if (this.descriptor.parameters !== undefined || this.focusTarget)
      throw new Error('Define action parameters once, before focus');
    const parameters: { [Key in keyof Schema]: Schema[Key] } = schema;
    const descriptor = { ...structuredClone(this.descriptor), parameters };

    return parser
      ? new ActionDefinition(this.registry, descriptor, (value) => parser.parse(value))
      : new ActionDefinition(this.registry, descriptor, (value) => value);
  }

  focus<Detail>(resolve: (params: Params) => VacpFocus<Detail> | undefined): this {
    this.focusTarget = resolve;
    return this;
  }

  handle<Result>(handler: VacpActionHandler<Params, Result>): VacpActionDescriptor {
    return this.registry.register(this.descriptor, handler, { parse: this.parse, focus: this.focusTarget });
  }
}
