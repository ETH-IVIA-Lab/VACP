import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      className={cn(
        'w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-100 outline-none',
        'focus:ring-2 focus:ring-sky-400/40',
        className,
      )}
    />
  ),
);
Input.displayName = 'Input';
