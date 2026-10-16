import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const repository = 'https://github.com/ETH-IVIA-Lab/VACP';
const YEAR = new Date().getFullYear();

const guide = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is VACP?', link: '/what-is-vacp/' },
      { text: 'Get started', link: '/get-started/' },
      { text: 'Core concepts', link: '/concepts/' },
    ],
  },
  {
    text: 'Connect sources',
    items: [
      { text: 'Connect an application', link: '/integrate/' },
      { text: 'Vega-Lite', link: '/vega-lite/' },
      { text: 'Mosaic vgplot', link: '/vgplot/' },
      { text: 'Compose sources', link: '/composition/' },
      { text: 'Declare availability', link: '/availability/' },
    ],
  },
  {
    text: 'Connect agents',
    items: [
      { text: 'Connect an agent', link: '/agents/' },
      { text: 'WebMCP', link: '/agents/webmcp' },
    ],
  },
  {
    text: 'Presence and history',
    items: [
      { text: 'Agent presence', link: '/presence/' },
      { text: 'Provenance and replay', link: '/provenance/' },
      { text: 'Inspection surfaces', link: '/inspector/' },
    ],
  },
  { text: 'Examples', link: '/examples/' },
  { text: 'API reference', link: '/api/' },
];

const reference = [
  { text: 'Overview', link: '/api/' },
  {
    text: 'Contracts',
    items: [
      { text: 'Protocol records', link: '/api/protocol' },
      { text: 'Agent tools', link: '/api/agent-tools' },
    ],
  },
  {
    text: 'Runtime',
    items: [
      { text: '@vacp/runtime', link: '/api/runtime' },
      { text: '@vacp/runtime-browser', link: '/api/browser' },
      { text: '@vacp/sdk', link: '/api/sdk' },
    ],
  },
  {
    text: 'Providers',
    items: [
      { text: '@vacp/adapter-vega-lite', link: '/api/vega-lite' },
      { text: '@vacp/adapter-vgplot', link: '/api/vgplot' },
      { text: '@vacp/data-duckdb', link: '/api/data-duckdb' },
    ],
  },
  {
    text: 'Agents',
    items: [
      { text: '@vacp/transport-bridge', link: '/api/transport-bridge' },
      { text: '@vacp/agent-ai-sdk', link: '/api/agent-ai-sdk' },
      { text: '@vacp/transport-webmcp', link: '/api/webmcp' },
      { text: 'vacp (Python)', link: '/api/python' },
    ],
  },
  {
    text: 'Presence and history',
    items: [
      { text: '@vacp/presence-core', link: '/api/presence-core' },
      { text: '@vacp/presence-browser', link: '/api/presence-browser' },
      { text: '@vacp/provenance-core', link: '/api/provenance' },
      { text: '@vacp/inspector-core', link: '/api/inspector' },
      { text: '@vacp/analytics', link: '/api/analytics' },
    ],
  },
];

export default defineConfig({
  title: 'VACP',
  description:
    'Lets AI agents read and change visual analyses through named operations, alongside the person using them.',
  srcDir: '../../docs',
  cleanUrls: true,
  lastUpdated: true,
  vite: {
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    cacheDir: process.env.VACP_VITE_CACHE_DIR,
    server: { host: '127.0.0.1', port: process.env.PORT ? Number(process.env.PORT) : undefined, strictPort: true },
  },
  themeConfig: {
    nav: [
      { text: 'Overview', link: '/what-is-vacp/' },
      { text: 'Guide', link: '/get-started/' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Reference', link: '/api/' },
    ],
    sidebar: { '/api/': reference, '/': guide },
    outline: [2, 3],
    search: { provider: 'local' },
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    socialLinks: [{ icon: 'github', link: repository }],
    footer: { copyright: `Copyright ${YEAR} VACP contributors` },
  },
});
