import type { VacpPlaybook, VacpPlaybookStep, VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '../types';

function pickPlaybook(playbooks: VacpPlaybook[], selectedId: string | null): VacpPlaybook | null {
  if (!playbooks.length) return null;
  if (selectedId) {
    const found = playbooks.find((d) => d.id === selectedId);
    if (found) return found;
  }
  return playbooks[0] ?? null;
}

export function renderPlaybookPane(args: {
  container: HTMLElement;
  runtime: VacpRuntimeSnapshot;
  bridge: VacpWindowBridge;
  playbooks: VacpPlaybook[];
  selectedId: string | null;
  selectedStepIdx: number;
  cursorStepIdx: number;
  lastResultText: string;
  lastErrorText: string;
  setSelected: (next: { playbookId?: string | null; stepIdx?: number; cursorIdx?: number }) => void;
  setOutput: (next: { lastResultText?: string; lastErrorText?: string }) => void;
}): void {
  const { container, bridge, playbooks, selectedId, selectedStepIdx, cursorStepIdx, lastResultText, lastErrorText, setSelected, setOutput } =
    args;
  container.textContent = '';

  const playbook = pickPlaybook(playbooks, selectedId);
  let resultText = lastResultText;
  let errorText = lastErrorText;

  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-section-title';
  title.textContent = 'Playbook';

  if (!playbook) {
    const empty = document.createElement('div');
    empty.className = 'vacp-debug-ui-small';
    empty.textContent = 'No playbooks available for this view.';
    container.append(title, empty);
    return;
  }

  const selectField = document.createElement('div');
  selectField.className = 'vacp-debug-ui-field';
  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Script';
  const select = document.createElement('select');
  playbooks.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.title;
    select.append(opt);
  });
  select.value = playbook.id;
  select.addEventListener('change', () => setSelected({ playbookId: select.value, stepIdx: 0 }));
  selectField.append(selectLabel, select);

  const desc = document.createElement('div');
  desc.className = 'vacp-debug-ui-small';
  desc.textContent = playbook.description ?? '';

  const stepsTitle = document.createElement('div');
  stepsTitle.className = 'vacp-debug-ui-section-title';
  stepsTitle.textContent = 'Steps';

  const stepCount = playbook.steps.length;
  const safeSelectedIdx = Math.max(0, Math.min(stepCount - 1, selectedStepIdx));
  const safeCursorIdx = Math.max(0, Math.min(stepCount, cursorStepIdx));
  const selectedStep = playbook.steps[safeSelectedIdx];
  const nextStep = playbook.steps[Math.min(stepCount - 1, safeCursorIdx)];

  const summary = document.createElement('div');
  summary.className = 'vacp-debug-ui-playbook-summary';

  const progress = document.createElement('div');
  progress.className = 'vacp-debug-ui-small';
  progress.textContent = `Next: ${safeCursorIdx}/${stepCount}${nextStep ? ` • ${nextStep.title}` : ''}`;

  const list = document.createElement('div');
  list.className = 'vacp-debug-ui-list';

  playbook.steps.forEach((s: VacpPlaybookStep, idx: number) => {
    const row = document.createElement('div');
    row.className = 'vacp-debug-ui-row';
    row.setAttribute('aria-selected', idx === safeSelectedIdx ? 'true' : 'false');
    row.dataset.vacpRow = 'playbook-step';
    if (idx < safeCursorIdx) row.dataset.status = 'done';
    else if (idx === safeCursorIdx) row.dataset.status = 'next';
    else row.dataset.status = 'todo';

    const line = document.createElement('div');
    line.className = 'vacp-debug-ui-playbook-step-title';
    line.textContent = `${idx} • ${s.title}`;

    const meta = document.createElement('div');
    meta.className = 'vacp-debug-ui-playbook-step-meta';
    meta.textContent = s.call?.name ? `action: ${s.call.name}` : 'info';

    row.append(line, meta);
    row.title = s.description ?? 'Click to select this step';
    row.addEventListener('click', () => setSelected({ stepIdx: idx }));
    list.append(row);
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'vacp-debug-ui-actions';

  const runNextBtn = document.createElement('button');
  runNextBtn.type = 'button';
  runNextBtn.textContent = 'Run next';
  runNextBtn.title = 'Runs the “Next” step and advances the cursor.';
  runNextBtn.disabled = safeCursorIdx >= stepCount;

  const runSelectedBtn = document.createElement('button');
  runSelectedBtn.type = 'button';
  runSelectedBtn.textContent = 'Run selected';
  runSelectedBtn.title = 'Runs the selected step (if it has an action). Advances Next to selected+1.';

  const setNextBtn = document.createElement('button');
  setNextBtn.type = 'button';
  setNextBtn.textContent = 'Set next';
  setNextBtn.title = 'Sets “Next” to the currently selected step without running it.';

  const runRemainingBtn = document.createElement('button');
  runRemainingBtn.type = 'button';
  runRemainingBtn.textContent = 'Run remaining';
  runRemainingBtn.title = 'Runs all remaining steps starting from “Next” (skips informational steps).';
  runRemainingBtn.disabled = safeCursorIdx >= stepCount;

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetBtn.title = 'Resets “Next” back to step 0.';
  resetBtn.disabled = safeCursorIdx === 0;

  btnRow.append(runNextBtn, runSelectedBtn, setNextBtn, runRemainingBtn, resetBtn);

  const detailTitle = document.createElement('div');
  detailTitle.className = 'vacp-debug-ui-section-title';
  detailTitle.textContent = 'Selected step';

  const details = document.createElement('div');
  details.className = 'vacp-debug-ui-small';
  const detailLines: string[] = [];
  detailLines.push(`${safeSelectedIdx} • ${selectedStep?.title ?? ''}`);
  if (selectedStep?.description) detailLines.push(selectedStep.description);
  if (selectedStep?.call) detailLines.push(`\naction: ${selectedStep.call.name}\n${JSON.stringify(selectedStep.call.params ?? {}, null, 2)}`);
  else detailLines.push('\n(no action; informational step)');
  details.textContent = detailLines.join('\n');

  const outTitle = document.createElement('div');
  outTitle.className = 'vacp-debug-ui-section-title';
  outTitle.textContent = 'Last result';

  const out = document.createElement('div');
  out.className = 'vacp-debug-ui-small';
  out.textContent = resultText;

  const outErr = document.createElement('div');
  outErr.className = 'vacp-debug-ui-small';
  outErr.textContent = errorText ? `error: ${errorText}` : '';

  const renderOutput = () => {
    out.textContent = resultText;
    outErr.textContent = errorText ? `error: ${errorText}` : '';
  };

  const dispatch = async (step: VacpPlaybookStep | undefined) => {
    if (!step?.call) return { ok: true, skipped: true as const };
    const call = { ...step.call, callId: crypto.randomUUID() };
    const res =
      typeof bridge.dispatch === 'function'
        ? await bridge.dispatch(call, { source: 'debug', message: 'playbook' })
        : await bridge.execute(call);
    return res;
  };

  const runStepIdx = async (idx: number, nextIdx?: number) => {
    errorText = '';
    resultText = '';
    setOutput({ lastErrorText: errorText, lastResultText: resultText });
    renderOutput();
    try {
      const res = await dispatch(playbook.steps[idx]);
      resultText = JSON.stringify(res, null, 2);
      errorText = '';
      setOutput({ lastResultText: resultText, lastErrorText: errorText });
      renderOutput();
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
      resultText = '';
      setOutput({ lastErrorText: errorText, lastResultText: resultText });
      renderOutput();
    }
    if (typeof nextIdx === 'number') setSelected({ cursorIdx: nextIdx });
  };

  runNextBtn.addEventListener('click', async () => {
    if (safeCursorIdx >= stepCount) return;
    const idx = safeCursorIdx;
    const step = playbook.steps[idx];
    if (!step?.call) {
      setSelected({ cursorIdx: idx + 1 });
      return;
    }
    await runStepIdx(idx, idx + 1);
  });

  runSelectedBtn.addEventListener('click', async () => {
    await runStepIdx(safeSelectedIdx, Math.max(safeCursorIdx, safeSelectedIdx + 1));
  });

  setNextBtn.addEventListener('click', () => setSelected({ cursorIdx: safeSelectedIdx }));

  runRemainingBtn.addEventListener('click', async () => {
    for (let i = safeCursorIdx; i < stepCount; i++) {
      const step = playbook.steps[i];
      if (!step?.call) {
        setSelected({ cursorIdx: i + 1 });
        continue;
      }
      await runStepIdx(i, i + 1);
    }
  });

  resetBtn.addEventListener('click', () => setSelected({ cursorIdx: 0 }));

  summary.append(progress);
  container.append(title, selectField, desc, stepsTitle, summary, list, btnRow, detailTitle, details, outTitle, outErr, out);
}
