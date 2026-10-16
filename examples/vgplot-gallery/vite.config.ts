import { defineExampleConfig } from '../../vite.shared';

export default defineExampleConfig({
  cacheName: 'vgplot-gallery',
  config: {
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  },
});
