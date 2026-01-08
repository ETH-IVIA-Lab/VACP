import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';

export function IconButton(props: {
  icon: ReactNode;
  label: string;
  title?: string;
  pressed?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  onClick?: () => void;
  onMouseDown?: (ev: ReactMouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="vacp-debug-ui-icon-button"
      aria-label={props.label}
      title={props.title ?? props.label}
      aria-pressed={typeof props.pressed === 'boolean' ? (props.pressed ? 'true' : 'false') : undefined}
      data-variant={props.variant ?? 'default'}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  );
}
