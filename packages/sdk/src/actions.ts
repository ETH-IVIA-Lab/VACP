import type {
  VacpActionDescriptor,
  VacpOperationKind,
  VacpOperationResultDescriptor,
  VacpRef,
  VacpSourceId,
} from '@vacp/protocol';
import {
  registerVacpApplyStateAction,
  type VacpApplyStateHandler,
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
  operation: (kind: VacpOperationKind, name: string, description: string) => VacpActionDefinition;
  standard: {
    applyState: <Result>(
      handler: VacpApplyStateHandler<Result>,
      options?: { affects?: VacpRef[]; description?: string },
    ) => VacpActionDescriptor;
    dataSchema: (
      handler: VacpDataSchemaHandler,
      options?: { inputRefs?: VacpRef[]; description?: string },
    ) => VacpActionDescriptor;
    dataSql: (
      handler: VacpDataSqlHandler,
      options?: Parameters<typeof registerVacpDataSqlAction>[2],
    ) => VacpActionDescriptor | null;
    widgetOptions: (
      handler: VacpWidgetOptionsHandler,
      options?: { inputRefs?: VacpRef[]; description?: string },
    ) => VacpActionDescriptor;
  };
};

export function createVacpActions(sourceId?: VacpSourceId): VacpActions {
  const registry = new VacpActionRegistry(sourceId);

  return {
    registry,
    operation: (kind, name, description) =>
      new VacpActionDefinition(registry, { name, description, operation: { kind } }, (value) => value),
    standard: {
      applyState: (handler, options) => registerVacpApplyStateAction(registry, handler, options),
      dataSchema: (handler, options) => registerVacpDataSchemaAction(registry, handler, options),
      dataSql: (handler, options) => registerVacpDataSqlAction(registry, handler, options),
      widgetOptions: (handler, options) => registerVacpWidgetOptionsAction(registry, handler, options),
    },
  };
}

/** A Zod schema or an application-owned parser. No schema generation is required. */
export type VacpActionParser<Params> = { parse: (value: unknown) => Params | Promise<Params> };

export class VacpActionDefinition<Params = unknown> {
  private readonly registry: VacpActionRegistry;
  private readonly descriptor: VacpActionDescriptor;

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
    const parameters: { [Key in keyof Schema]: Schema[Key] } = schema;
    const descriptor = { ...this.descriptor, parameters };

    return parser
      ? new VacpActionDefinition(this.registry, descriptor, (value) => parser.parse(value))
      : new VacpActionDefinition(this.registry, descriptor, (value) => value);
  }

  handle<Result>(handler: VacpActionHandler<Params, Result>): VacpActionDescriptor {
    return this.registry.register(this.descriptor, async (params, options) => {
      const parsed = await this.parse(params);
      options.signal?.throwIfAborted();
      return handler(parsed, options);
    });
  }
}
