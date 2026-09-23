import { test as setup } from '@playwright/test';
import { appServers } from './helpers/servers';

// The gallery loads each example on demand, so each route optimizes its own dependencies.
const galleryRoutes = ['athletes/', 'vgplot/', 'vega-lite/', 'react-dashboard/', 'cars-parcoords/'];

for (const server of appServers.filter((server) => server.dev)) {
  setup(`warm ${server.name}`, async ({ page }) => {
    const urls =
      server.name === 'gallery' ? galleryRoutes.map((route) => new URL(route, server.url).href) : [server.url];
    for (const url of urls) {
      await page.goto(url);
      await page.waitForFunction(() => !!window.__vacp, undefined, { timeout: 60_000 });
    }
  });
}
