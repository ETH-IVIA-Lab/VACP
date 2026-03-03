import './gallery.css';
import rawManifest from '../examples.manifest.json';
import { normalizeManifest } from './contracts';

const entries = normalizeManifest(rawManifest);

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function renderHome(root: HTMLElement): void {
  const cards = entries
    .map((entry) => {
      const title = escapeHtml(entry.title);
      const description = escapeHtml(entry.description);
      const route = escapeHtml(entry.route);
      return `
      <a class="gallery-card" href="./${route}/" data-route="${route}">
        <p class="gallery-card__title">${title}</p>
        <p class="gallery-card__description">${description}</p>
        <span class="gallery-card__cta">Open example</span>
      </a>
    `;
    })
    .join('\n');

  root.innerHTML = `
    <main class="gallery-home">
      <header class="gallery-home__header">
        <p class="gallery-home__eyebrow">VACP</p>
        <h1>Examples Gallery</h1>
      </header>

      <section class="gallery-home__grid">
        ${cards}
      </section>
    </main>
  `;
}

const root = document.getElementById('gallery-home-root');
if (!root) throw new Error('Missing #gallery-home-root');

renderHome(root);
