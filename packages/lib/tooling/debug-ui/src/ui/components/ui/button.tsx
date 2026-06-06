import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium',
    'transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/45',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    '[aria-pressed=true]:bg-emerald-300/10 [aria-pressed=true]:border-emerald-200/25 [aria-pressed=true]:text-emerald-50',
  ),
  {
    variants: {
      variant: {
        ghost: 'border border-white/9 bg-white/[0.035] text-slate-100/86 hover:border-white/14 hover:bg-white/[0.065]',
        primary:
          'border border-emerald-200/28 bg-emerald-300/11 text-emerald-50 hover:border-emerald-200/38 hover:bg-emerald-300/16',
        danger: 'border border-red-200/20 bg-red-300/8 text-red-50/88 hover:border-red-200/30 hover:bg-red-300/12',
      },
      size: {
        sm: 'h-8 px-2.5',
        // `icon` is used heavily in module toolbars; keep it compact and crisp.
        icon: 'h-8 w-8 p-0',
        iconSm: 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'icon',
    },
  },
);

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
