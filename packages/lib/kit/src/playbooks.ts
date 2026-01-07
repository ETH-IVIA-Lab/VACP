import type { VacpPlaybook, VacpPlaybookStep } from '@vacp/core';

export type VacpPlaybookBuilder = {
  step: (title: string, options?: { description?: string }) => VacpPlaybookBuilder;
  action: (
    title: string,
    call: { name: string; params?: unknown },
    options?: { description?: string },
  ) => VacpPlaybookBuilder;
  note: (title: string, description: string) => VacpPlaybookBuilder;
  build: () => VacpPlaybook;
};

/**
 * Small DSL for provider-supplied "scripts" used by the debug overlay.
 *
 * This keeps examples readable without baking demo logic into the core runtime.
 */
export function playbook(args: { id: string; title: string; description?: string }): VacpPlaybookBuilder {
  const steps: VacpPlaybookStep[] = [];
  const add = (s: VacpPlaybookStep) => {
    steps.push(s);
    return builder;
  };
  const builder: VacpPlaybookBuilder = {
    step: (title, options) => add({ title, description: options?.description }),
    note: (title, description) => add({ title, description }),
    action: (title, call, options) => add({ title, description: options?.description, call }),
    build: () => ({ id: args.id, title: args.title, description: args.description, steps }),
  };
  return builder;
}
