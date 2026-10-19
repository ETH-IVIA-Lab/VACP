import { renderExampleError } from '@ethivia/vacp-example-shared';
import { mount } from './mfe';

const root = document.getElementById('vacp-example-root');
if (!root) throw new Error('Missing #vacp-example-root');
mount(root).catch((error: unknown) => renderExampleError(root, error));
