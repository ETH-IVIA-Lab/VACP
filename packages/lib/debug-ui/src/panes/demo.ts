import type { VacpDemo, VacpDemoStep, VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '../types';

function pickDemo(demos: VacpDemo[], selectedId: string | null): VacpDemo | null {
  if (!demos.length) return null;
  if (selectedId) {
    const found = demos.find((d) => d.id === selectedId);
    if (found) return found;
  }
  return demos[0] ?? null;
}

export function renderDemoPane(args: {
  container: HTMLElement;
  runtime: VacpRuntimeSnapshot;
  bridge: VacpWindowBridge;
  demos: VacpDemo[];
  selectedDemoId: string | null;
  selectedStepIdx: number;
  setSelected: (next: { demoId?: string | null; stepIdx?: number }) => void;
}): void {
  const { container, bridge, demos, selectedDemoId, selectedStepIdx, setSelected } = args;
  container.textContent = '';

  const demo = pickDemo(demos, selectedDemoId);

  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-section-title';
  title.textContent = 'Demo';

  if (!demo) {
    const empty = document.createElement('div');
    empty.className = 'vacp-debug-ui-small';
    empty.textContent = 'No demos available for this view.';
    container.append(title, empty);
    return;
  }

  const selectField = document.createElement('div');
  selectField.className = 'vacp-debug-ui-field';
  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Script';
  const select = document.createElement('select');
  demos.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.title;
    select.append(opt);
  });
  select.value = demo.id;
  select.addEventListener('change', () => setSelected({ demoId: select.value, stepIdx: 0 }));
  selectField.append(selectLabel, select);

  const desc = document.createElement('div');
  desc.className = 'vacp-debug-ui-small';
  desc.textContent = demo.description ?? '';

  const stepsTitle = document.createElement('div');
  stepsTitle.className = 'vacp-debug-ui-section-title';
  stepsTitle.textContent = 'Steps';

  const list = document.createElement('div');
  list.className = 'vacp-debug-ui-list';

  demo.steps.forEach((s: VacpDemoStep, idx: number) => {
    const row = document.createElement('div');
    row.className = 'vacp-debug-ui-row';
    row.setAttribute('aria-selected', idx == selectedStepIdx ? 'true' : 'false');
    row.textContent = `${idx} • ${s.title}${s.call?.name ? ` • ${s.call.name}` : ''}`;
    row.title = s.description ?? 'Click to select this step';
    row.addEventListener('click', () => setSelected({ stepIdx: idx }));
    list.append(row);
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'vacp-debug-ui-actions';
  const stepBtn = document.createElement('button');
  stepBtn.type = 'button';
  stepBtn.textContent = 'Run step';
  stepBtn.title = 'Dispatch the selected demo step (if it has an action call)';
  const runAllBtn = document.createElement('button');
  runAllBtn.type = 'button';
  runAllBtn.textContent = 'Run all';
  runAllBtn.title = 'Run all demo steps sequentially (skips informational steps)';
  btnRow.append(stepBtn, runAllBtn);

  const out = document.createElement('div');
  out.className = 'vacp-debug-ui-small';
  out.textContent = '';

  const runStep = async (idx: number) => {
    const step = demo.steps[idx];
    if (!step?.call) {
      out.textContent = '(informational step)';
      return;
    }
    const call = { ...step.call, callId: crypto.randomUUID() };
    const res =
      typeof bridge.dispatch === 'function'
        ? await bridge.dispatch(call, { source: 'debug', message: 'demo' })
        : await bridge.execute(call);
    out.textContent = JSON.stringify(res, null, 2);
  };

  stepBtn.addEventListener('click', async () => {
    await runStep(selectedStepIdx);
  });
  runAllBtn.addEventListener('click', async () => {
    for (let i = 0; i < demo.steps.length; i++) {
      if (!demo.steps[i]?.call) continue;
      await runStep(i);
    }
  });

  container.append(title, selectField, desc, stepsTitle, list, btnRow, out);
}
