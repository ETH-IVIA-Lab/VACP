export type FocusSnapshot = {
  focusId: string;
  selectionStart?: number;
  selectionEnd?: number;
  scrollTop?: number;
};

function isTextLike(el: Element): el is HTMLTextAreaElement | HTMLInputElement {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

export function captureFocus(root: HTMLElement): FocusSnapshot | null {
  const active = document.activeElement;
  if (!active || !(active instanceof HTMLElement)) return null;
  if (!root.contains(active)) return null;

  const focusId = active.dataset.vacpFocus;
  if (!focusId) return null;

  const snap: FocusSnapshot = { focusId };
  if (isTextLike(active)) {
    if (typeof active.selectionStart === 'number') snap.selectionStart = active.selectionStart;
    if (typeof active.selectionEnd === 'number') snap.selectionEnd = active.selectionEnd;
  }
  if (active instanceof HTMLTextAreaElement) snap.scrollTop = active.scrollTop;
  return snap;
}

export function restoreFocus(root: HTMLElement, snap: FocusSnapshot | null): void {
  if (!snap) return;

  const active = document.activeElement;
  if (active && active instanceof HTMLElement && root.contains(active) && active.dataset.vacpFocus) {
    return;
  }

  const target = root.querySelector<HTMLElement>(`[data-vacp-focus="${CSS.escape(snap.focusId)}"]`);
  if (!target) return;

  target.focus({ preventScroll: true });

  if (isTextLike(target)) {
    const start = snap.selectionStart ?? target.value.length;
    const end = snap.selectionEnd ?? start;
    try {
      target.setSelectionRange(start, end);
    } catch {
      // ignore
    }
  }

  if (target instanceof HTMLTextAreaElement && typeof snap.scrollTop === 'number') {
    target.scrollTop = snap.scrollTop;
  }
}

