import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const repository = 'https://github.com/ETH-IVIA-Lab/VACP';
// GitHub Pages serves the site under the repository path, which `actions/configure-pages` reports.
const basePath = process.env.BASE_PATH?.replace(/\/+$/, '') ?? '';
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
      { text: '@ethivia/vacp-runtime', link: '/api/runtime' },
      { text: '@ethivia/vacp-browser', link: '/api/browser' },
      { text: '@ethivia/vacp-sdk', link: '/api/sdk' },
    ],
  },
  {
    text: 'Providers',
    items: [
      { text: '@ethivia/vacp-vega-lite', link: '/api/vega-lite' },
      { text: '@ethivia/vacp-vgplot', link: '/api/vgplot' },
      { text: '@ethivia/vacp-duckdb', link: '/api/data-duckdb' },
    ],
  },
  {
    text: 'Agents',
    items: [
      { text: '@ethivia/vacp-bridge', link: '/api/transport-bridge' },
      { text: '@ethivia/vacp-ai-sdk', link: '/api/agent-ai-sdk' },
      { text: '@ethivia/vacp-webmcp', link: '/api/webmcp' },
      { text: 'vacp (Python)', link: '/api/python' },
    ],
  },
  {
    text: 'Presence and history',
    items: [
      { text: '@ethivia/vacp-presence', link: '/api/presence-core' },
      { text: '@ethivia/vacp-presence-react', link: '/api/presence-browser' },
      { text: '@ethivia/vacp-provenance', link: '/api/provenance' },
      { text: '@ethivia/vacp-inspector', link: '/api/inspector' },
      { text: '@ethivia/vacp-analytics', link: '/api/analytics' },
    ],
  },
];

export default defineConfig({
  title: 'VACP',
  description:
    'Lets AI agents read and change visual analyses through named operations, alongside the person using them.',
  base: `${basePath}/`,
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
