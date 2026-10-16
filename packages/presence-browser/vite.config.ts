import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';
import workspace from '../../vite.config';
import { vacpPresenceSheet } from '../../vite.shared';

export default defineConfig({
  pack: {
    ...(workspace.pack as Exclude<typeof workspace.pack, readonly unknown[]>),
    plugins: [vacpPresenceSheet(fileURLToPath(new URL('../..', import.meta.url)))],
  },
});
