import type { TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '@vacp/inspector/ui/lib/utils';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      {...props}
      className={cn(
        'w-full rounded-lg border border-white/[0.08] bg-[#101821]/72 px-3 py-2.5 text-xs text-slate-100/90 outline-none',
        'placeholder:text-slate-100/34 focus:border-white/22 focus:ring-2 focus:ring-white/22',
        "font-[ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace]",
        'whitespace-pre',
        className,
      )}
    />
  ),
);

Textarea.displayName = 'Textarea';
