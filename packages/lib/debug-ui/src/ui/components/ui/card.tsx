import type { HTMLAttributes } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn('rounded-xl border border-white/10 bg-white/5 p-3 text-slate-100 shadow-sm', props.className)}
    />
  );
}

export function CardHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('flex items-center justify-between gap-3', props.className)} />;
}

export function CardTitle(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn('text-xs font-semibold tracking-wider uppercase text-slate-100/70', props.className)} />
  );
}

export function CardDescription(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('mt-1 text-[11px] text-slate-100/80', props.className)} />;
}
