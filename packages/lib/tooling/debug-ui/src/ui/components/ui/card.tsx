import type { HTMLAttributes } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        'rounded-xl border border-white/[0.075] bg-[#0b1115]/62 p-4 text-slate-100 shadow-[0_8px_22px_rgba(0,0,0,0.12)]',
        props.className,
      )}
    />
  );
}

export function CardHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('flex items-center justify-between gap-3', props.className)} />;
}

export function CardTitle(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('text-xs font-semibold uppercase text-slate-100/70', props.className)} />;
}

export function CardDescription(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('mt-1 text-pretty text-[11px] text-slate-100/66', props.className)} />;
}
