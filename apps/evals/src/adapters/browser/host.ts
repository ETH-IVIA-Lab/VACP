import { chromium } from 'playwright';

import { EvalPage } from './page';
import { serveGallery, type ServeMode } from './serve';

/** Chromium exposes `document.modelContext` and its testing entry point behind these flags. */
const webmcpBrowserArgs = ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'];

export type Gallery = Awaited<ReturnType<typeof openGallery>>;

/**
 * The example gallery in a WebMCP-enabled Chromium: the one already running at `baseURL`, or one this
 * process serves until `close`.
 */
export async function openGallery(options: {
  repoRoot: string;
  serve: ServeMode;
  port: number;
  baseURL?: string;
  signal: AbortSignal;
}) {
  const server = options.baseURL
    ? undefined
    : await serveGallery(options.repoRoot, options.serve, options.port, options.signal);
  const url = options.baseURL ?? server!.url;
  const browser = await chromium.launch({ args: webmcpBrowserArgs }).catch((error: unknown) => {
    server?.close();
    throw error;
  });
  return {
    url,
    /** Open `path` in a browser context of its own. `close` closes the context and its page. */
    async open(path: string, signal: AbortSignal) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, ignoreHTTPSErrors: true });
      const close = () => context.close().catch(() => {});
      try {
        return { page: await EvalPage.open(context, new URL(path, url).href, signal), close };
      } catch (error) {
        await close();
        throw error;
      }
    },
    async close() {
      await browser.close().catch(() => {});
      server?.close();
    },
  };
}
