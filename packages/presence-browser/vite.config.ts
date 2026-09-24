import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';
import workspace from '../../vite.config';
import { vacpPresenceSheet } from '../../vite.shared';

export default defineConfig({
  pack: { ...workspace.pack, plugins: [vacpPresenceSheet(fileURLToPath(new URL('../..', import.meta.url)))] },
});
