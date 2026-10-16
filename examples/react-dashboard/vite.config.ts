import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineExampleConfig } from '../../vite.shared';

export default defineExampleConfig({ cacheName: 'react-dashboard', config: { plugins: [react(), tailwind()] } });
