import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';
import { rewriteLlmsLinks } from './llms-links';

const repository = 'https://github.com/ETH-IVIA-Lab/VACP';
// GitHub Pages serves the site under the repository path, which `actions/configure-pages` reports.
const basePath = process.env.BASE_PATH?.replace(/\/+$/, '') ?? '';
const YEAR = new Date().getFullYear();
const description =
  'Lets AI agents read and change visual analyses through named actions, alongside the person using them.';
const examples = { text: 'Examples', link: '/examples/' };

const guide = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is VACP?', link: '/what-is-vacp/' },
      { text: 'Get started', link: '/get-started/' },
      { text: 'Install', link: '/install/' },
      { text: 'Core concepts', link: '/concepts/' },
    ],
  },
  {
    text: 'Connect sources',
    items: [
      { text: 'Custom provider', link: '/custom-provider/' },
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
    text: 'Presence and provenance',
    items: [
      { text: 'Agent presence', link: '/presence/' },
      { text: 'Provenance and replay', link: '/provenance/' },
      { text: 'Inspector', link: '/inspector/' },
    ],
  },
  examples,
  { text: 'API reference', link: '/api/' },
];

const reference = [
  { text: 'Overview', link: '/api/' },
  {
    text: '@ethivia/vacp-sdk',
    items: [
      { text: 'Actions and providers', link: '/api/actions' },
      { text: 'Runtime and page bridge', link: '/api/runtime' },
      { text: 'Provenance and replay', link: '/api/provenance' },
      { text: 'Protocol types', link: '/api/protocol' },
      { text: '/data', link: '/api/data' },
      { text: '/presence', link: '/api/presence' },
      { text: '/agent', link: '/api/agent' },
      { text: '/inspector', link: '/api/inspector' },
      { text: 'Agent tools', link: '/api/agent-tools' },
    ],
  },
  {
    text: 'Integrations',
    items: [
      { text: '@ethivia/vacp-vega', link: '/api/vega' },
      { text: '@ethivia/vacp-vgplot', link: '/api/vgplot' },
      { text: '@ethivia/vacp-duckdb', link: '/api/duckdb' },
      { text: '@ethivia/vacp-ai', link: '/api/ai' },
      { text: '@ethivia/vacp-overlay', link: '/api/overlay' },
      { text: '@ethivia/vacp-posthog', link: '/api/posthog' },
      { text: 'vacp (Python)', link: '/api/python' },
    ],
  },
];

// Index links stay root-relative and carry the base, so docs.vacp.dev and GitHub Pages each serve an
// `llms.txt` that points into their own copy of the pages.
// SAFETY: The plugin's declarations resolve `vite` to the workspace's Vite+ core, and VitePress runs
// the same plugin hooks on its own Vite release.
const llms = llmstxt({
  description,
  // The home page tagline restates the description.
  details: '',
  // The index lists the guide, the examples, and then the reference. Its sections stay one level deep
  // because the plugin drops the base from links in nested sections.
  sidebar: [
    ...guide,
    { text: 'Examples', items: [examples] },
    { text: 'API reference', items: reference.flatMap((item) => item.items ?? [item]) },
  ],
}) as [Plugin, Plugin];

export default defineConfig({
  title: 'VACP',
  description,
  base: `${basePath}/`,
  srcDir: '../../docs',
  cleanUrls: true,
  lastUpdated: true,
  buildEnd: rewriteLlmsLinks,
  vite: {
    // The plugin's dev middleware joins the raw request path onto `outDir`, so `../` reads `.md` and `.txt`
    // files anywhere on disk. The text views come from the docs build.
    plugins: llms.map((plugin) => ({ ...plugin, configureServer: undefined })),
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
