import type { ReactNode } from 'react';

import { cn } from '../lib/utils';

export function PlaceholderPanel({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn('flex h-full min-h-0 w-full items-center justify-center bg-background p-6 text-center', className)}
    >
      <div className="mx-auto flex max-w-[420px] flex-col items-center gap-3">
        {icon ? (
          <div className="flex h-10 w-10 items-center justify-center bg-muted/20 text-muted-foreground ">{icon}</div>
        ) : null}
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>
        {actions ? <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{actions}</div> : null}
      </div>
    </div>
  );
}
