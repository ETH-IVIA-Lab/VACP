export async function copyTextToClipboard(text: string): Promise<void> {
  const t = text ?? '';

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(t);

      return;
    } catch {
      // Use the textarea copy path when Clipboard API writes are blocked.
    }
  }

  const el = document.createElement('textarea');
  el.value = t;
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.append(el);
  el.select();

  try {
    document.execCommand('copy');
  } catch {
    // ignore
  } finally {
    el.remove();
  }
}
