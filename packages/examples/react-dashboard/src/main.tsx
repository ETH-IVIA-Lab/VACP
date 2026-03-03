import { mountReactDashboard } from './bootstrap';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

mountReactDashboard(root);
