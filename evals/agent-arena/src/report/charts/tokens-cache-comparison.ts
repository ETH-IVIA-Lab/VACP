import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, maxOf, paddedMax, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type TokensMedianByBasisChartConfig = ArenaFigureLayout;

type TokenBasis = 'no-cache' | 'with-cache';

function medianTokenRows(ctx: Parameters<ArenaChart<TokensMedianByBasisChartConfig>['getData']>[0], basis: TokenBasis) {
  const rows: Array<{ experiment: string; tokens_median: number }> = [];

  for (const summary of ctx.summaries) {
    if (!ctx.experimentDomain.includes(summary.experiment)) continue;
    const value = basis === 'no-cache' ? summary.tokensMedianNoCache : summary.tokensMedianWithCacheAll;

    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    rows.push({
      experiment: summary.experiment,
      tokens_median: value,
    });
  }

  return rows;
}

function renderMedianTokenBars(args: {
  ctx: Parameters<ArenaChart<TokensMedianByBasisChartConfig>['render']>[0];
  config: TokensMedianByBasisChartConfig | undefined;
  basis: TokenBasis;
  id: string;
  title: string;
  caption: string;
  barFill: string;
}) {
  const data = medianTokenRows(args.ctx, args.basis);
  const maxTokens = maxOf(data, (d) => d.tokens_median);

  const layout = resolveLayout(
    args.ctx.theme,
    { height: 320, marginLeft: 72, marginRight: 24, marginTop: 24, marginBottom: 64 },
    args.config,
  );

  const svg = plotSvg({
    theme: args.ctx.theme,
    plot: Plot.plot({
      document: args.ctx.document,
      width: layout.width,
      height: layout.height,
      marginLeft: layout.marginLeft,
      marginRight: layout.marginRight,
      marginTop: layout.marginTop,
      marginBottom: layout.marginBottom,
      x: { domain: args.ctx.experimentDomain, tickRotate: -20, label: null, tickSize: 0 },
      y: {
        label: 'Median tokens',
        grid: true,
        nice: true,
        domain: [0, paddedMax(maxTokens)],
      },
      marks: [
        Plot.ruleY([0], { stroke: args.ctx.theme.colors.grid }),
        Plot.barY(data, {
          x: 'experiment',
          y: 'tokens_median',
          fill: args.barFill,
          inset: 8,
          title: (d) => `${d.experiment}\nMedian tokens: ${fmtNumber(Math.round(d.tokens_median))}`,
        }),
        Plot.text(data, {
          x: 'experiment',
          y: 'tokens_median',
          text: (d) => fmtNumber(Math.round(d.tokens_median)),
          dy: -8,
          fill: args.ctx.theme.colors.ink,
          fontSize: 11,
          textAnchor: 'middle',
        }),
      ],
    }),
  });

  return {
    id: args.id,
    title: args.title,
    caption: args.caption,
    svg,
    data,
  };
}

export const tokensMedianNoCacheChart: ArenaChart<TokensMedianByBasisChartConfig> = {
  id: 'tokens-median-no-cache',
  title: 'Median Token Accounting by Experiment: No Cache',
  caption: 'Supporting view with no-cache medians by experiment.',
  isApplicable: (ctx) => ctx.summaries.some((s) => typeof s.tokensMedianNoCache === 'number'),
  getData: (ctx) => medianTokenRows(ctx, 'no-cache'),
  render: (ctx, config) =>
    renderMedianTokenBars({
      ctx,
      config,
      basis: 'no-cache',
      id: 'tokens-median-no-cache',
      title: 'Median Token Accounting by Experiment: No Cache',
      caption: 'Supporting view with no-cache medians by experiment.',
      barFill: ctx.theme.colors.info,
    }),
};

export const tokensMedianWithCacheChart: ArenaChart<TokensMedianByBasisChartConfig> = {
  id: 'tokens-median-with-cache',
  title: 'Median Token Accounting by Experiment: With Cache',
  caption: 'Primary token view with cache-aware medians by experiment.',
  isApplicable: (ctx) => ctx.summaries.some((s) => typeof s.tokensMedianWithCacheAll === 'number'),
  getData: (ctx) => medianTokenRows(ctx, 'with-cache'),
  render: (ctx, config) =>
    renderMedianTokenBars({
      ctx,
      config,
      basis: 'with-cache',
      id: 'tokens-median-with-cache',
      title: 'Median Token Accounting by Experiment: With Cache',
      caption: 'Primary token view with cache-aware medians by experiment.',
      barFill: ctx.theme.colors.info,
    }),
};
