import type { VacpActionDescriptor, VacpRef } from '@vacp/core';
import {
  registerVacpApplyStateAction,
  type VacpApplyStateHandler,
  registerVacpDataSqlAction,
  type VacpDataSqlHandler,
  VacpActionRegistry,
} from '@vacp/gateway';

type JsonSchemaLike = Record<string, unknown>;

export type VacpActions = {
  registry: VacpActionRegistry;
  action: (name: string, description: string) => VacpActionDefinition;
  standard: {
    applyState: (
      handler: VacpApplyStateHandler,
      options?: { targetRef?: VacpRef; description?: string },
    ) => VacpActionDescriptor;
    dataSql: (
      handler: VacpDataSqlHandler,
      options?: { targetRef?: VacpRef; description?: string },
    ) => VacpActionDescriptor;
  };
};

export function createVacpActions(): VacpActions {
  const registry = new VacpActionRegistry();
  return {
    registry,
    action: (name, description) => new VacpActionDefinition(registry, { name, description }),
    standard: {
      applyState: (handler, options) => registerVacpApplyStateAction(registry, handler, options as any),
      dataSql: (handler, options) => registerVacpDataSqlAction(registry, handler, options as any),
    },
  };
}

export class VacpActionDefinition {
  private readonly registry: VacpActionRegistry;
  private readonly descriptor: VacpActionDescriptor;

  constructor(registry: VacpActionRegistry, base: { name: string; description: string }) {
    this.registry = registry;
    this.descriptor = { name: base.name, description: base.description };
  }

  title(title: string): this {
    this.descriptor.title = title;
    return this;
  }

  target(ref: VacpRef): this {
    this.descriptor.targetRef = ref;
    return this;
  }

  params(schema: JsonSchemaLike): this {
    this.descriptor.parameters = schema;
    return this;
  }

  handle(handler: (params: unknown) => unknown | Promise<unknown>): VacpActionDescriptor {
    this.registry.register(this.descriptor, handler);
    return this.descriptor;
  }
}
