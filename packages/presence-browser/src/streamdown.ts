import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Streamdown, type StreamdownProps } from 'streamdown';
import type { PresenceTextRenderer, PresenceTextUpdate } from './text';

// Words arrive in sentences, not tokens: the stagger spreads each sentence over a readable moment
// and the backlog cap keeps a long paragraph from lagging behind the cursor.
const animation = {
  animation: 'vacpReveal',
  duration: 240,
  easing: 'cubic-bezier(.22,1,.36,1)',
  sep: 'word',
  stagger: 34,
  maxBacklogMs: 480,
} as const;
const components: StreamdownProps['components'] = {
  strong: ({ children }) => createElement('strong', null, children),
  em: ({ children }) => createElement('em', null, children),
};
const allowedElements = ['p', 'strong', 'em', 'del', 'code', 'br', 'ul', 'ol', 'li', 'blockquote', 'span'];
const proseStyle = `
.vacp-streamdown{font:inherit;color:inherit;line-height:1.55;overflow-wrap:anywhere}
.vacp-streamdown p,.vacp-streamdown blockquote{margin:0}.vacp-streamdown>*+*{margin-top:.55em}
.vacp-streamdown strong{font-weight:600;color:#172438}.vacp-streamdown em{font-style:italic}
.vacp-streamdown ul,.vacp-streamdown ol{margin:0;padding-left:1.25em}.vacp-streamdown li{margin:.18em 0}
.vacp-streamdown code{font: .92em ui-monospace,monospace;background:#f1f5f9;border-radius:3px;padding:.08em .25em}
.vacp-streamdown blockquote{border-left:2px solid #cbd5e1;padding-left:.7em;color:#64748b}
@keyframes sd-vacpReveal{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
.vacp-streamdown [data-sd-animate]{animation:var(--sd-animation) var(--sd-duration) var(--sd-easing) var(--sd-delay,0ms) both}
[data-streaming]>.vacp-streamdown>:last-child:not(ul):not(ol)::after,[data-streaming]>.vacp-streamdown>:is(ul,ol):last-child>li:last-child:not(:has(>p))::after,[data-streaming]>.vacp-streamdown>:is(ul,ol):last-child>li:last-child>p:last-child::after{content:'';display:inline-block;width:2px;height:.95em;margin-left:.14em;vertical-align:-.12em;border-radius:1px;background:#4f6fd8;animation:var(--vacp-caret-motion,vacp-caret 1s steps(2,jump-none) infinite)}
@keyframes vacp-caret{from{opacity:1}to{opacity:0}}
[data-reduced]{--vacp-caret-motion:none}
@media(prefers-reduced-motion:reduce){.vacp-streamdown [data-sd-animate]{animation:none!important}}
`;

// Agents send whole sentences. Revealing them a word at a time, about 14 words a second and never
// slower than 2.6 s for the whole message, is what makes the bubble read as a live stream.
const paceMs = 70;
const paceBudgetMs = 2600;

function nextWordEnd(text: string, from: number): number {
  const match = /\S+\s*/.exec(text.slice(from));
  return match ? from + match[0].length : text.length;
}

/** Plain reading text for announcements: Markdown emphasis and code markers removed. */
function plainText(markdown: string): string {
  return markdown
    .replace(/[*_`~]+/g, '')
    .replace(/^\s*[>#-]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Streamdown's incremental Markdown renderer, isolated from the default browser entry point. */
export function createStreamdownText(container: HTMLElement): PresenceTextRenderer {
  const view = container.ownerDocument.defaultView!;
  const style = container.ownerDocument.createElement('style');
  style.textContent = proseStyle;
  const scope = container.getRootNode();
  (scope.nodeType === 11 ? scope : container.ownerDocument.head).appendChild(style);
  const root = createRoot(container);
  let frame = 0;
  let timer = 0;
  let latest: PresenceTextUpdate | undefined;
  let shown = '';
  const paint = () => {
    frame = 0;
    const value = latest!;
    const revealing = shown.length < value.text.length;
    const streaming = value.streaming || revealing;
    // Completed and replayed text renders statically; only a live stream repairs incomplete Markdown and animates.
    const props: StreamdownProps = {
      children: shown.replaceAll('<', '&lt;'),
      className: 'vacp-streamdown',
      mode: streaming ? 'streaming' : 'static',
      parseIncompleteMarkdown: streaming,
      isAnimating: streaming,
      animated: streaming && !value.reducedMotion ? animation : false,
      allowedElements,
      unwrapDisallowed: true,
      controls: false,
      components,
    };
    root.render(createElement(Streamdown, { ...props, key: value.revision }));
    container.toggleAttribute('data-streaming', streaming);
    container.toggleAttribute('data-reduced', value.reducedMotion);
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(paint);
  };
  const reveal = () => {
    timer = 0;
    const text = latest!.text;
    if (shown.length >= text.length) return;
    shown = text.slice(0, nextWordEnd(text, shown.length));
    schedule();
    const remaining = text.slice(shown.length).split(/\s+/).filter(Boolean).length;
    if (remaining) timer = view.setTimeout(reveal, Math.min(paceMs, paceBudgetMs / remaining));
  };
  return {
    render(update) {
      if (
        latest?.text === update.text &&
        latest.revision === update.revision &&
        latest.streaming === update.streaming &&
        latest.reducedMotion === update.reducedMotion
      )
        return;
      const continues = latest?.revision === update.revision && update.text.startsWith(shown);
      latest = update;
      if (update.reducedMotion) {
        view.clearTimeout(timer);
        timer = 0;
        shown = update.text;
      } else if (!continues) {
        view.clearTimeout(timer);
        shown = '';
        reveal();
      } else if (!timer) reveal();
      // A running cadence keeps its beat and picks up appended words on its next tick.
      schedule();
    },
    readText: () => (latest ? plainText(latest.text) : ''),
    dispose() {
      view.cancelAnimationFrame(frame);
      view.clearTimeout(timer);
      root.unmount();
      style.remove();
    },
  };
}
