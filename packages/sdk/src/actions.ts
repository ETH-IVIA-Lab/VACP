import { getVacpBrowserOptions } from '@vacp/runtime-browser';
import type { VacpActionDescriptor, VacpRef } from '@vacp/protocol';
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
  action: (name: string, description: string) => VacpActionDefinition;
  standard: {
    applyState: <Result>(
      handler: VacpApplyStateHandler<Result>,
      options?: { targetRef?: VacpRef; description?: string },
    ) => VacpActionDescriptor;
    dataSchema: (
      handler: VacpDataSchemaHandler,
      options?: { targetRef?: VacpRef; description?: string },
    ) => VacpActionDescriptor;
    dataSql: (
      handler: VacpDataSqlHandler,
      options?: { targetRef?: VacpRef; description?: string },
    ) => VacpActionDescriptor | null;
    widgetOptions: (
      handler: VacpWidgetOptionsHandler,
      options?: { targetRef?: VacpRef; description?: string },
    ) => VacpActionDescriptor;
  };
};

export function createVacpActions(): VacpActions {
  const registry = new VacpActionRegistry();

  return {
    registry,
    action: (name, description) => new VacpActionDefinition(registry, { name, description }, (value) => value),
    standard: {
      applyState: (handler, options) => registerVacpApplyStateAction(registry, handler, options),
      dataSchema: (handler, options) => registerVacpDataSchemaAction(registry, handler, options),
      dataSql: (handler, options) =>
        registerVacpDataSqlAction(registry, handler, { enabled: getVacpBrowserOptions().enableSql, ...options }),
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

  target(ref: VacpRef): this {
    this.descriptor.targetRef = ref;

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
    this.registry.register(this.descriptor, async (params, options) => {
      const parsed = await this.parse(params);
      options.signal?.throwIfAborted();
      return handler(parsed, options);
    });

    return this.descriptor;
  }
}
