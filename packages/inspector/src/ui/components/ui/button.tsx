import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '@vacp/inspector/ui/lib/utils';

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium',
    'transition-[background-color,border-color,color,transform]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/36',
    'disabled:pointer-events-none disabled:opacity-50',
    'enabled:active:scale-[0.97]',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    '[aria-pressed=true]:bg-white/[0.085] [aria-pressed=true]:border-white/14 [aria-pressed=true]:text-slate-50',
  ),
  {
    variants: {
      variant: {
        ghost: 'border border-white/9 bg-white/[0.035] text-slate-100/86 hover:border-white/14 hover:bg-white/[0.065]',
        primary:
          'border border-slate-100/22 bg-white/[0.085] text-slate-50 hover:border-white/32 hover:bg-white/[0.115]',
        danger: 'border border-red-200/20 bg-red-300/8 text-red-50/88 hover:border-red-200/30 hover:bg-red-300/12',
      },
      size: {
        sm: 'h-8 px-2.5',
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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';

  return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});
