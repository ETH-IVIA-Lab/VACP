import { toJSONSchema, type $ZodType, type output } from 'zod/v4/core';
import type {
  VacpActionDescriptor,
  VacpOperationKind,
  VacpOperationResultDescriptor,
  VacpRef,
  VacpFocus,
  VacpSourceId,
} from '../protocol';
import { parseVacpParams, VacpActionRegistry, type VacpActionHandler } from '../runtime';

/** An action registry that also defines Zod-typed actions with `operation`. */
export class VacpActions extends VacpActionRegistry {
  operation(kind: VacpOperationKind, name: string, description: string): VacpActionBuilder {
    return new ActionDefinition(this, { name, description, operation: { kind } }, (value) => value);
  }
}

export function createVacpActions(sourceId?: VacpSourceId): VacpActions {
  return new VacpActions(sourceId);
}

type VacpActionMetadata<Next> = {
  title(title: string): Next;
  contract(contract: string): Next;
  requires(...refs: VacpRef[]): Next;
  input(...refs: VacpRef[]): Next;
  affects(...refs: VacpRef[]): Next;
  produces(result: VacpOperationResultDescriptor): Next;
};

/** Parsed parameters stay fixed once execution or presentation behavior is bound. */
interface VacpActionDefinition<Params = unknown> extends VacpActionMetadata<VacpActionDefinition<Params>> {
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

  input(...refs: VacpRef[]): this {
    this.descriptor.operation.inputRefs = [...(this.descriptor.operation.inputRefs ?? []), ...refs];

    return this;
  }

  affects(...refs: VacpRef[]): this {
    this.descriptor.operation.affects = [...(this.descriptor.operation.affects ?? []), ...refs];

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

    return new ActionDefinition(this.registry, descriptor, parseVacpParams(descriptor.name, schema));
  }

  focus<Detail>(resolve: (params: Params) => VacpFocus<Detail> | undefined): this {
    this.focusTarget = resolve;
    return this;
  }

  handle<Result>(handler: VacpActionHandler<Params, Result>): VacpActionDescriptor {
    return this.registry.register(this.descriptor, handler, { parse: this.parse, focus: this.focusTarget });
  }
}
