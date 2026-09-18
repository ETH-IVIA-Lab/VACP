import type { HTMLAttributes, ReactElement, ReactNode, RefObject } from 'react';

import { cn } from '@vacp/inspector/ui/lib/utils';

type ModuleRootProps = HTMLAttributes<HTMLDivElement> & {
  rootRef?: RefObject<HTMLDivElement | null>;
  boundWide?: boolean;
};

type ModuleCommandBarProps = HTMLAttributes<HTMLDivElement> & {
  [dataAttribute: `data-${string}`]: string | undefined;
};

type ModuleHeaderProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  commandBarProps?: ModuleCommandBarProps;
};

type ModulePaneProps = HTMLAttributes<HTMLDivElement> & {
  paneRef?: RefObject<HTMLDivElement | null>;
  tone?: 'plain' | 'surface' | 'code';
};

type ModuleSubheaderProps = HTMLAttributes<HTMLDivElement>;

export function ModuleRoot({ rootRef, boundWide, className, ...props }: ModuleRootProps): ReactElement {
  return (
    <div
      ref={rootRef}
      className={cn('h-full min-h-0 min-w-0', boundWide && 'mx-auto w-full max-w-[1500px]', className)}
      {...props}
    />
  );
}

export function ModuleHeader({
  title,
  description,
  actions,
  compact,
  commandBarProps,
  className,
  ...props
}: ModuleHeaderProps): ReactElement {
  const { className: commandBarClassName, ...restCommandBarProps } = commandBarProps ?? {};

  return (
    <div
      className={cn(
        'flex shrink-0 items-start justify-between gap-2.5 border-b border-white/[0.075] pb-2.5',
        compact && 'flex-col items-stretch gap-2',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">
        <div className="min-w-0 break-words text-[12px] font-semibold leading-4 text-slate-100/86">{title}</div>
        {description ? <div className="mt-0.5 text-pretty text-[11px] text-slate-100/58">{description}</div> : null}
      </div>
      {actions ? (
        <ModuleCommandBar compact={compact} className={commandBarClassName} {...restCommandBarProps}>
          {actions}
        </ModuleCommandBar>
      ) : null}
    </div>
  );
}

function ModuleCommandBar({
  children,
  compact,
  className,
  ...props
}: ModuleCommandBarProps & { children: ReactNode; compact?: boolean }): ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5',
        compact
          ? 'w-full flex-nowrap justify-start overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'shrink-0 flex-wrap justify-end',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModuleSubheader({ className, ...props }: ModuleSubheaderProps): ReactElement {
  return (
    <div
      className={cn('flex min-h-7 shrink-0 items-center gap-1.5 text-[11px] text-slate-100/72', className)}
      {...props}
    />
  );
}

export function ModulePane({ paneRef, tone = 'plain', className, ...props }: ModulePaneProps): ReactElement {
  return (
    <section
      ref={paneRef}
      className={cn(
        'min-h-0 min-w-0 text-slate-100',
        tone === 'surface' &&
          'rounded-md border border-white/[0.065] bg-white/[0.016] shadow-[inset_0_1px_0_rgba(255,255,255,0.015)]',
        tone === 'code' && 'rounded-md border border-white/[0.065] bg-[#0f171d]/82',
        className,
      )}
      {...props}
    />
  );
}

export function ModuleField(props: {
  label: ReactNode;
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}): ReactElement {
  return (
    <div className={props.className}>
      <label id={props.labelId} className="text-[11px] font-medium text-slate-100/70" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      <div className={cn('mt-1', props.innerClassName)}>{props.children}</div>
    </div>
  );
}

export function ModuleEmptyState(props: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cn('text-[12px] leading-5 text-slate-100/66', props.className)}>{props.children}</div>;
}
