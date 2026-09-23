import './gallery.css';
import { examples as entries } from '../examples.manifest';

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
        <h1>Visual analysis, shared.</h1>
        <p class="gallery-home__intro">Five interactive dashboards. Brush, filter, and compare them yourself, or let an agent work alongside you.</p>
      </header>

      <section class="gallery-home__grid">
        ${cards}
      </section>
      <footer class="gallery-home__footer"><a href="https://docs.vacp.dev">Documentation</a><a href="https://github.com/ETH-IVIA-Lab/VACP">Source</a></footer>
    </main>
  `;
}

const root = document.getElementById('gallery-home-root');

if (!root) throw new Error('Missing #gallery-home-root');

renderHome(root);
