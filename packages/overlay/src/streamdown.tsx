import * as stylex from '@stylexjs/stylex';
import { createContext, use, useEffect, useMemo, useState, type ComponentProps, type JSX } from 'react';
import { Streamdown, type StreamdownProps } from 'streamdown';
import type { PresenceText, PresenceTextProps } from './text';
import { color, ease } from './tokens.stylex';

// Agents send whole sentences. Revealing them a word at a time, about 14 words a second and never
// slower than 2.6 s for the whole message, is what makes the bubble read as a live stream.
const paceMs = 70;
const paceBudgetMs = 2600;
const wordPattern = /\S+\s*/;

const reveal = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(2px)' },
  to: { opacity: 1, transform: 'none' },
});
const blink = stylex.keyframes({ from: { opacity: 1 }, to: { opacity: 0 } });

const styles = stylex.create({
  prose: { lineHeight: 1.55, overflowWrap: 'anywhere' },
  block: { marginTop: { default: '.55em', ':first-child': 0 }, marginBottom: 0 },
  // A thin text cursor marks the end of the words while they are still arriving.
  caret: {
    '::after': {
      content: { default: 'none', ':last-child': "''" },
      display: 'inline-block',
      width: 2,
      height: '.95em',
      marginLeft: '.14em',
      // Offset by transform, so the caret never deepens the line and resizes the label when it leaves.
      verticalAlign: 'baseline',
      transform: 'translateY(.12em)',
      borderRadius: 1,
      backgroundColor: color.agent,
      animationName: { default: blink, '@media (prefers-reduced-motion: reduce)': 'none' },
      animationDuration: '1s',
      animationTimingFunction: 'steps(2, jump-none)',
      animationIterationCount: 'infinite',
    },
  },
  steadyCaret: { '::after': { animationName: 'none' } },
  list: { marginTop: { default: '.55em', ':first-child': 0 }, marginBottom: 0, paddingLeft: '1.25em' },
  item: { marginBlock: '.18em' },
  strong: { fontWeight: 600, color: color.strong },
  em: { fontStyle: 'italic' },
  code: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '.92em',
    backgroundColor: color.code,
    borderRadius: 3,
    paddingBlock: '.08em',
    paddingInline: '.25em',
  },
  quote: {
    marginTop: { default: '.55em', ':first-child': 0 },
    marginBottom: 0,
    marginInline: 0,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: color.quote,
    paddingLeft: '.7em',
    color: color.control,
  },
  word: {
    animationName: { default: reveal, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: 'var(--sd-duration, 240ms)',
    animationTimingFunction: `var(--sd-easing, ${ease.reveal})`,
    animationDelay: 'var(--sd-delay, 0ms)',
    animationFillMode: 'both',
  },
});

/** Words still arriving: the last block carries the caret. */
const Streaming = createContext<{ streaming: boolean; reducedMotion: boolean }>({
  streaming: false,
  reducedMotion: false,
});

type Element<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & { node?: unknown };

function Paragraph({ node: _node, className: _className, ...props }: Element<'p'>) {
  const { streaming, reducedMotion } = use(Streaming);
  return (
    <p {...props} {...stylex.props(styles.block, streaming && styles.caret, reducedMotion && styles.steadyCaret)} />
  );
}
function Item({ node: _node, className: _className, ...props }: Element<'li'>) {
  const { streaming, reducedMotion } = use(Streaming);
  return (
    <li {...props} {...stylex.props(styles.item, streaming && styles.caret, reducedMotion && styles.steadyCaret)} />
  );
}
// Streamdown marks each revealed word with `data-sd-animate` and its timing in custom properties.
function Span({ node: _node, className: _className, ...props }: Element<'span'> & { 'data-sd-animate'?: unknown }) {
  return <span {...props} {...stylex.props(props['data-sd-animate'] !== undefined && styles.word)} />;
}

const components: StreamdownProps['components'] = {
  p: Paragraph,
  li: Item,
  span: Span,
  ul: ({ node: _node, className: _className, ...props }: Element<'ul'>) => (
    <ul {...props} {...stylex.props(styles.list)} />
  ),
  ol: ({ node: _node, className: _className, ...props }: Element<'ol'>) => (
    <ol {...props} {...stylex.props(styles.list)} />
  ),
  strong: ({ node: _node, className: _className, ...props }: Element<'strong'>) => (
    <strong {...props} {...stylex.props(styles.strong)} />
  ),
  em: ({ node: _node, className: _className, ...props }: Element<'em'>) => (
    <em {...props} {...stylex.props(styles.em)} />
  ),
  code: ({ node: _node, className: _className, ...props }: Element<'code'>) => (
    <code {...props} {...stylex.props(styles.code)} />
  ),
  blockquote: ({ node: _node, className: _className, ...props }: Element<'blockquote'>) => (
    <blockquote {...props} {...stylex.props(styles.quote)} />
  ),
};
const allowedElements = ['p', 'strong', 'em', 'del', 'code', 'br', 'ul', 'ol', 'li', 'blockquote', 'span'];
const animation = {
  animation: 'vacpReveal',
  duration: 240,
  easing: 'cubic-bezier(.22,1,.36,1)',
  sep: 'word',
  stagger: 34,
  maxBacklogMs: 480,
} as const;

const nextWord = (text: string, from: number) => {
  const match = wordPattern.exec(text.slice(from));
  return text.slice(0, match ? from + match[0].length : text.length);
};

/**
 * One revision of the message, revealed a word at a time when it may animate and shown whole otherwise.
 * Words appended to the same revision join the running cadence; replaced words start again.
 */
function Reveal({ text, streaming, animate, reducedMotion }: Omit<PresenceTextProps, 'revision'>) {
  const [revealed, setRevealed] = useState(() => (animate ? nextWord(text, 0) : text));
  // A view that may not animate, such as the unseen copy that sizes the label, shows every word at once.
  const shown = !animate ? text : text.startsWith(revealed) ? revealed : '';
  useEffect(() => {
    if (!animate || shown.length >= text.length) return;
    const next = nextWord(text, shown.length);
    const remaining = text.slice(next.length).split(/\s+/).filter(Boolean).length + 1;
    const timer = setTimeout(() => setRevealed(next), shown ? Math.min(paceMs, paceBudgetMs / remaining) : 0);
    return () => clearTimeout(timer);
  }, [animate, text, shown]);
  const live = streaming || shown.length < text.length;
  const caret = useMemo(() => ({ streaming: live, reducedMotion }), [live, reducedMotion]);
  return (
    <Streaming value={caret}>
      {/* Marks the words as still arriving, for assistive and automated readers alike. */}
      <div data-vacp-prose="" data-streaming={live ? '' : undefined}>
        <Streamdown
          className={stylex.props(styles.prose).className}
          mode={live ? 'streaming' : 'static'}
          parseIncompleteMarkdown={live}
          isAnimating={live}
          animated={live && !reducedMotion ? animation : false}
          allowedElements={allowedElements}
          unwrapDisallowed
          controls={false}
          components={components}
        >
          {shown.replaceAll('<', '&lt;')}
        </Streamdown>
      </div>
    </Streaming>
  );
}

function StreamdownView({ revision, ...props }: PresenceTextProps) {
  return <Reveal key={revision} {...props} animate={props.animate && !props.reducedMotion} />;
}

/** Plain reading text for announcements: Markdown emphasis and code markers removed. */
function speak(markdown: string): string {
  return markdown
    .replace(/[*_`~]+/g, '')
    .replace(/^\s*[>#-]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Streamdown's incremental Markdown renderer for the presence bubble: emphasis, inline code, paragraphs,
 * and lists, revealed a word at a time while an agent streams.
 */
export const streamdownText: PresenceText = { View: StreamdownView, speak };
