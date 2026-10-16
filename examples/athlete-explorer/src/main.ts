import { renderExampleError } from '@vacp/example-shared';
import { mount } from './mfe';

const root = document.querySelector<HTMLElement>('#athletes-root');
if (!root) throw new Error('Missing #athletes-root');
mount(root).catch((error: unknown) => renderExampleError(root, error));
