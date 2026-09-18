import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef, ElementRef } from 'react';
import { forwardRef } from 'react';

import { cn } from '@vacp/inspector/ui/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

export const Tooltip = TooltipPrimitive.Root;

export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-[2147483647] pointer-events-none select-none overflow-hidden rounded-md border border-white/[0.075] bg-[#0d1419] px-2 py-1 text-[11px] text-neutral-100 ',
      className,
    )}
    {...props}
  />
));

TooltipContent.displayName = TooltipPrimitive.Content.displayName;
