import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentPropsWithoutRef, ElementRef } from 'react';
import { forwardRef } from 'react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex flex-col gap-1.5 rounded-xl bg-transparent p-0 text-slate-100', className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2.5 text-left text-xs text-slate-100/88',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
      'hover:bg-white/8',
      'data-[state=active]:border-sky-300/35 data-[state=active]:bg-sky-500/12 data-[state=active]:text-slate-50 data-[state=active]:shadow-[inset_0_0_0_2px_rgba(121,178,255,0.14)]',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = TabsPrimitive.Content;
