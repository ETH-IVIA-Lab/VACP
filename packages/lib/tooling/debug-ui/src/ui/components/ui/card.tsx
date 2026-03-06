import type { HTMLAttributes } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        'rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-slate-100 shadow-[0_8px_24px_rgba(0,0,0,0.18)]',
        props.className,
      )}
    />
  );
}

export function CardHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('flex items-center justify-between gap-3', props.className)} />;
}

export function CardTitle(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('text-xs font-semibold uppercase text-slate-100/72', props.className)} />;
}

export function CardDescription(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('mt-1 text-pretty text-[11px] text-slate-100/78', props.className)} />;
}
