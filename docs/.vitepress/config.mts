import { defineConfig } from 'vitepress';
import { configureDiagramsPlugin } from 'vitepress-plugin-diagrams';

const YEAR = new Date().getFullYear();

export default defineConfig({
  title: 'VACP',
  description: 'A small in-app protocol for capabilities, state snapshots, and semantic actions.',
  cleanUrls: true,
  markdown: {
    config: (md) => {
      configureDiagramsPlugin(md, {
        diagramsDir: 'public/diagrams',
        publicPath: '/diagrams',
        krokiServerUrl: process.env.VACP_KROKI_SERVER_URL ?? 'https://kroki.io',
      });
    },
  },
  themeConfig: {
    nav: [
      { text: 'Overview', link: '/what-is-vacp/' },
      {
        text: 'Guide',
        items: [
          { text: 'Get started', link: '/get-started/' },
          { text: 'Core runtime', link: '/core-runtime/' },
          { text: 'Providers', link: '/providers/' },
          { text: 'Transports', link: '/transports/' },
          { text: 'Debug overlay', link: '/debug/' },
          { text: 'Evaluation', link: '/evaluation/' },
        ],
      },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'Reference',
        items: [
          { text: 'Tool Contract', link: '/reference/tool-contract' },
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'Glossary', link: '/reference/glossary' },
        ],
      },
    ],
    sidebar: {
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Tool Contract', link: '/reference/tool-contract' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Glossary', link: '/reference/glossary' },
          ],
        },
      ],
      '/': [
        {
          text: 'Introduction',
          collapsed: false,
          items: [
            { text: 'What is VACP?', link: '/what-is-vacp/' },
            { text: 'Why VACP?', link: '/why-vacp/' },
            { text: 'Get started', link: '/get-started/' },
          ],
        },
        {
          text: 'Guide',
          collapsed: false,
          items: [
            { text: 'Core runtime', link: '/core-runtime/' },
            { text: 'Providers', link: '/providers/' },
            { text: 'Transports', link: '/transports/' },
            { text: 'Debug overlay', link: '/debug/' },
            { text: 'Evaluation', link: '/evaluation/' },
          ],
        },
        { text: 'Examples', link: '/examples/' },
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Tool Contract', link: '/reference/tool-contract' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Glossary', link: '/reference/glossary' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
    },
    footer: {
      message: 'VACP documentation.',
      copyright: `Copyright ${YEAR} VACP contributors`,
    },
  },
});
