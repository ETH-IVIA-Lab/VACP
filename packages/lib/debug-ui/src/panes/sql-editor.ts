function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const KEYWORDS = new Set(
  [
    'select',
    'from',
    'where',
    'group',
    'by',
    'order',
    'limit',
    'offset',
    'as',
    'and',
    'or',
    'not',
    'in',
    'between',
    'like',
    'is',
    'null',
    'true',
    'false',
    'case',
    'when',
    'then',
    'else',
    'end',
    'distinct',
    'union',
    'all',
    'join',
    'left',
    'right',
    'inner',
    'outer',
    'on',
    'having',
    'with',
    'describe',
    'explain',
    'create',
    'table',
    'view',
    'temporary',
    'insert',
    'into',
    'values',
    'update',
    'set',
    'delete',
  ].map((s) => s.toLowerCase()),
);

function highlightSql(sql: string): string {
  const s = sql ?? '';
  let i = 0;
  const out: string[] = [];

  const push = (cls: string | null, text: string) => {
    const escaped = escapeHtml(text);
    out.push(cls ? `<span class="${cls}">${escaped}</span>` : escaped);
  };

  const isWordStart = (ch: string) => /[A-Za-z_]/.test(ch);
  const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  const isDigit = (ch: string) => /[0-9]/.test(ch);

  while (i < s.length) {
    const ch = s[i] ?? '';
    const next = s[i + 1] ?? '';

    // Line comment: -- ...
    if (ch === '-' && next === '-') {
      const start = i;
      i += 2;
      while (i < s.length && s[i] !== '\n') i++;
      push('vacp-sql-comment', s.slice(start, i));
      continue;
    }

    // Block comment: /* ... */
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < s.length) {
        if (s[i] === '*' && s[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      push('vacp-sql-comment', s.slice(start, i));
      continue;
    }

    // Single-quoted string: '...'
    if (ch === "'") {
      const start = i;
      i++;
      while (i < s.length) {
        if (s[i] === "'") {
          // Escaped quote: ''
          if (s[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      push('vacp-sql-string', s.slice(start, i));
      continue;
    }

    // Double-quoted identifier: "..."
    if (ch === '"') {
      const start = i;
      i++;
      while (i < s.length) {
        if (s[i] === '"') {
          if (s[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      push('vacp-sql-ident', s.slice(start, i));
      continue;
    }

    // Number literal
    if (isDigit(ch)) {
      const start = i;
      i++;
      while (i < s.length && isDigit(s[i] ?? '')) i++;
      if (s[i] === '.' && isDigit(s[i + 1] ?? '')) {
        i += 2;
        while (i < s.length && isDigit(s[i] ?? '')) i++;
      }
      push('vacp-sql-number', s.slice(start, i));
      continue;
    }

    // Word / keyword
    if (isWordStart(ch)) {
      const start = i;
      i++;
      while (i < s.length && isWord(s[i] ?? '')) i++;
      const word = s.slice(start, i);
      push(KEYWORDS.has(word.toLowerCase()) ? 'vacp-sql-keyword' : null, word);
      continue;
    }

    // Everything else (whitespace, punctuation)
    push(null, ch);
    i++;
  }

  return out.join('');
}

export type SqlEditor = {
  root: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  getValue: () => string;
  setValue: (value: string) => void;
};

export function createSqlEditor(args: {
  value: string;
  title?: string;
  focusId?: string;
  onInput?: (value: string) => void;
}): SqlEditor {
  const root = document.createElement('div');
  root.className = 'vacp-debug-ui-sql';

  const pre = document.createElement('pre');
  pre.className = 'vacp-debug-ui-sql-highlight';
  const code = document.createElement('code');
  pre.append(code);

  const textarea = document.createElement('textarea');
  textarea.className = 'vacp-debug-ui-sql-input';
  textarea.value = args.value;
  textarea.title = args.title ?? '';
  if (args.focusId) textarea.dataset.vacpFocus = args.focusId;

  const render = () => {
    // Keep a trailing newline so the last line always has height.
    const v = textarea.value ?? '';
    code.innerHTML = `${highlightSql(v)}\n`;
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  };

  textarea.addEventListener('scroll', () => {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  });
  textarea.addEventListener('input', () => {
    render();
    args.onInput?.(textarea.value);
  });

  render();
  root.append(pre, textarea);

  return {
    root,
    textarea,
    getValue: () => textarea.value,
    setValue: (value: string) => {
      textarea.value = value;
      render();
      args.onInput?.(textarea.value);
    },
  };
}

