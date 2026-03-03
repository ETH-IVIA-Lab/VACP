import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';

import { Button } from '@vacp/debug-ui/ui/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@vacp/debug-ui/ui/components/ui/tooltip';

export function IconButton(props: {
  icon: ReactNode;
  label: string;
  title?: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  size?: 'icon' | 'iconSm';
  onClick?: () => void;
  onMouseDown?: (ev: ReactMouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const variant = props.variant === 'primary' ? 'primary' : props.variant === 'danger' ? 'danger' : 'ghost';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size={props.size ?? 'icon'}
          variant={variant}
          disabled={props.disabled}
          aria-label={props.label}
          aria-pressed={typeof props.pressed === 'boolean' ? (props.pressed ? 'true' : 'false') : undefined}
          onMouseDown={props.onMouseDown}
          onClick={props.onClick}
        >
          {props.icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.title ?? props.label}</TooltipContent>
    </Tooltip>
  );
}
