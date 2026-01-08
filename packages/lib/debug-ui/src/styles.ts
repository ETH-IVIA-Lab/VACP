import { CSS_BASE } from './styles/css-base';
import { CSS_EXTRAS } from './styles/css-extras';

const CSS = `${CSS_BASE}\n${CSS_EXTRAS}`;

export function ensureStyles(): void {
  if (document.getElementById('vacp-debug-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'vacp-debug-ui-style';
  style.textContent = CSS;
  document.head.append(style);
}
