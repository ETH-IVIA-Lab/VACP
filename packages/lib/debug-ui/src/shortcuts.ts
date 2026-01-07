import type { DebugTab } from './types';

/**
 * Keyboard shortcuts (debug overlay ergonomics).
 *
 * Intentionally minimal and opt-in (panel must be open):
 * - Esc closes
 * - Alt+1..6 switches tabs
 * - Alt+L cycles layout
 * - Alt+R refreshes snapshots
 */
export function installVacpDebugShortcuts(args: {
  isPanelVisible: () => boolean;
  setPanelVisible: (visible: boolean) => void;
  setTab: (tab: DebugTab) => void;
  requestRender: () => void;
  cycleLayout: () => void;
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

    const tabByKey: Record<string, DebugTab> = {
      '1': 'Graph',
      '2': 'Data',
      '3': 'Actions',
      '4': 'History',
      '5': 'Playbook',
      '6': 'JSON',
    };
    const t = tabByKey[ev.key];
    if (t) {
      ev.preventDefault();
      args.setTab(t);
      args.requestRender();
      return;
    }

    if (ev.key.toLowerCase() === 'l') {
      ev.preventDefault();
      args.cycleLayout();
      return;
    }

    if (ev.key.toLowerCase() === 'r') {
      ev.preventDefault();
      args.refresh();
      return;
    }
  });
}
