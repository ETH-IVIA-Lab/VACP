import { mount } from './mfe';
const root = document.querySelector<HTMLElement>('#athletes-root');
if (!root) throw new Error('Missing athlete dashboard root');
void mount(root);
