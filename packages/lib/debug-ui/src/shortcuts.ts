import type { VacpDebugModuleId } from './types';

/**
 * Keyboard shortcuts (overlay ergonomics).
 *
 * Intentionally minimal and opt-in (panel must be open):
 * - Esc closes
 * - Alt+1..9 selects modules by order
 * - Alt+R refreshes snapshots
 */
export function installVacpDebugShortcuts(args: {
  isPanelVisible: () => boolean;
  setPanelVisible: (visible: boolean) => void;
  moduleIds: VacpDebugModuleId[];
  selectModule: (id: VacpDebugModuleId) => void;
  refresh: () => void;
}) {
  window.addEventListener('keydown', (ev) => {
    if (!args.isPanelVisible()) return;
    const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase?.() ?? '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (ev.key === 'Escape') {
      args.setPanelVisible(false);
      return;
    }

    if (!ev.altKey) return;

    if (ev.key.toLowerCase() === 'r') {
      ev.preventDefault();
      args.refresh();
      return;
    }

    const n = Number(ev.key);
    if (!Number.isFinite(n) || n <= 0) return;
    const id = args.moduleIds[n - 1];
    if (!id) return;
    ev.preventDefault();
    args.selectModule(id);
  });
}
