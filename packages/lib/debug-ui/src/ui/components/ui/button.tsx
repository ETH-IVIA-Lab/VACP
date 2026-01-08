import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium',
    'transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        ghost: 'bg-white/5 hover:bg-white/10 text-slate-100 border border-white/10',
        primary: 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-100 border border-sky-300/35',
        danger: 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-100 border border-rose-300/35',
      },
      size: {
        sm: 'h-8 px-2.5',
        icon: 'h-9 w-9 p-0',
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

