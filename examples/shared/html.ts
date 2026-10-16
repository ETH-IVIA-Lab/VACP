export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Replace `target`'s content with the message of an example that failed to mount or render. */
export function renderExampleError(target: HTMLElement, error: unknown): void {
  const message = document.createElement('pre');
  message.setAttribute('role', 'alert');
  message.textContent = String(error);
  Object.assign(message.style, {
    margin: '0',
    padding: '12px',
    border: '1px solid #fecaca',
    borderRadius: '10px',
    background: '#fef2f2',
    color: '#991b1b',
    whiteSpace: 'pre-wrap',
  });
  target.replaceChildren(message);
}
