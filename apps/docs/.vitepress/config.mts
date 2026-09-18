import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { configureDiagramsPlugin } from 'vitepress-plugin-diagrams';

const YEAR = new Date().getFullYear();

export default defineConfig({
  title: 'VACP',
  srcDir: '../../docs',
  vite: {
    cacheDir: process.env.VACP_VITE_CACHE_DIR,
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    server: { host: '127.0.0.1', port: process.env.PORT ? Number(process.env.PORT) : undefined, strictPort: true },
  },
  description: 'A composable protocol for analytical sources, observations, and semantic operations.',
  cleanUrls: true,
  markdown: {
    config: (md) => {
      configureDiagramsPlugin(md, {
        diagramsDir: fileURLToPath(new URL('../public/diagrams', import.meta.url)),
        publicPath: '/diagrams',
        krokiServerUrl: process.env.VACP_KROKI_SERVER_URL ?? 'https://kroki.io',
      });
    },
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/get-started/' },
      { text: 'Providers', link: '/providers/' },
      { text: 'Reference', link: '/reference/runtime' },
      { text: 'Examples', link: '/examples/' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'What is VACP?', link: '/what-is-vacp/' },
          { text: 'Get started', link: '/get-started/' },
          { text: 'Custom integration', link: '/integrate/' },
        ],
      },
      {
        text: 'Providers',
        items: [
          { text: 'Choose a provider', link: '/providers/' },
          { text: 'Compose providers', link: '/providers/composition' },
          { text: 'Vega-Lite', link: '/providers/vega-lite' },
          { text: 'VGPlot', link: '/providers/vgplot' },
        ],
      },
      {
        text: 'Use VACP',
        items: [
          { text: 'Inspector', link: '/inspector/' },
          { text: 'Connect an agent', link: '/transports/' },
          { text: 'WebMCP', link: '/transports/webmcp' },
          { text: 'Examples', link: '/examples/' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Runtime', link: '/reference/runtime' },
          { text: 'Browser adapter', link: '/reference/browser' },
          { text: 'Tool contract', link: '/reference/tool-contract' },
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'Glossary', link: '/reference/glossary' },
        ],
      },
    ],
    search: { provider: 'local' },
    footer: { copyright: `Copyright ${YEAR} VACP contributors` },
  },
});
