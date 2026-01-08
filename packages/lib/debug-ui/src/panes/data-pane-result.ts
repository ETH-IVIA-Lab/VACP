import { isDataSqlResult, renderResultTable } from './data-helpers';

export function createResultSection(args: {
  maxRows: number;
  viewMode: 'table' | 'json';
  lastResultText?: string;
}): {
  title: HTMLDivElement;
  meta: HTMLDivElement;
  resolvedDetails: HTMLDetailsElement;
  out: HTMLDivElement;
} {
  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-section-title';
  title.textContent = 'Result';

  const meta = document.createElement('div');
  meta.className = 'vacp-debug-ui-small';

  const resolvedDetails = document.createElement('details');
  resolvedDetails.className = 'vacp-debug-ui-details';
  const resolvedSummary = document.createElement('summary');
  resolvedSummary.textContent = 'Resolved SQL';
  const resolvedBody = document.createElement('div');
  resolvedBody.className = 'vacp-debug-ui-small';
  resolvedBody.textContent = '';
  resolvedDetails.append(resolvedSummary, resolvedBody);

  const out = document.createElement('div');
  out.className = 'vacp-debug-ui-table-wrap';

  if (args.lastResultText) {
    try {
      const parsed = JSON.parse(args.lastResultText);
      if (isDataSqlResult(parsed)) {
        resolvedBody.textContent = parsed.resolvedSql ?? '';
        resolvedDetails.open = false;
        const rows = parsed.format === 'json' ? parsed.rows?.length ?? 0 : 0;
        const truncated = parsed.format === 'json' ? !!parsed.truncated : false;
        meta.textContent =
          parsed.format === 'json'
            ? `format=json • rows=${rows}${truncated ? ` (truncated, maxRows=${args.maxRows})` : ''}`
            : `format=${parsed.format}`;
        if (args.viewMode === 'table') renderResultTable(out, parsed);
        else out.textContent = args.lastResultText;
      } else {
        meta.textContent = '';
        resolvedBody.textContent = '';
        out.textContent = args.lastResultText;
      }
    } catch {
      meta.textContent = '';
      resolvedBody.textContent = '';
      out.textContent = args.lastResultText;
    }
  } else {
    meta.textContent = '';
    resolvedBody.textContent = '';
    out.textContent = '';
  }

  return { title, meta, resolvedDetails, out };
}

