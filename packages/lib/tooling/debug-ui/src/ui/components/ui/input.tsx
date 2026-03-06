import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      className={cn(
        'w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2.5 text-xs text-slate-100 outline-none',
        'focus:ring-2 focus:ring-sky-400/40',
        className,
      )}
    />
  ),
);
Input.displayName = 'Input';
