import { select, scaleLinear, format } from 'd3';
import type { Athlete, Cohort, SportSummary } from './model';

const number = format(',');
const percent = format('.1%');
const PAGE_SIZE = 10;

function createPager(root: HTMLElement, label: string, onChange: () => void) {
  let page = 0;
  root.innerHTML = `<button type="button" aria-label="Previous ${label}">Previous</button><span aria-live="polite"></span><button type="button" aria-label="Next ${label}">Next</button>`;
  const [previous, next] = root.querySelectorAll('button');
  const status = root.querySelector('span')!;
  const back = () => {
    page--;
    onChange();
  };
  const forward = () => {
    page++;
    onChange();
  };
  previous!.addEventListener('click', back);
  next!.addEventListener('click', forward);
  return {
    entries<Item>(items: Item[]): Item[] {
      const last = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
      page = Math.max(0, Math.min(page, last));
      const start = page * PAGE_SIZE;
      previous!.disabled = page === 0;
      next!.disabled = page === last;
      status.textContent = items.length
        ? `${start + 1}–${Math.min(start + PAGE_SIZE, items.length)} of ${number(items.length)}`
        : '0 results';
      return items.slice(start, start + PAGE_SIZE);
    },
    dispose() {
      previous!.removeEventListener('click', back);
      next!.removeEventListener('click', forward);
    },
  };
}
export function createDashboard(root: HTMLElement, model: Cohort) {
  root.style.setProperty('--athlete-page-size', String(PAGE_SIZE));
  root.innerHTML = `
    <header class="athlete-intro"><div><p class="athlete-kicker">RIO 2016 · 11,538 ATHLETES</p>
      <h2>Different sports. Different profiles.</h2><p>Explore who competed, and how your cohort compares across sports.</p></div>
      <label class="athlete-sex">Sex<select aria-label="Sex"><option value="all">All athletes</option><option value="female">Female</option><option value="male">Male</option></select></label>
    </header>
    <p class="athlete-error" role="alert" hidden></p>
    <div class="athlete-summary" aria-label="Cohort summary" aria-live="polite"></div>
    <div class="athlete-charts">
      <section aria-labelledby="body-title"><div class="athlete-section-heading"><h3 id="body-title">Height & weight</h3><span>Vega-Lite</span></div><p class="athlete-caption">Drag a rectangle to select · double-click to clear</p><div data-view="body" class="athlete-plot"></div><p data-missing class="athlete-caption"></p></section>
      <section aria-labelledby="age-title"><div class="athlete-section-heading"><h3 id="age-title">Age distribution</h3><span>vgplot</span></div><p class="athlete-caption">Drag a range to select · click outside it to clear</p><div data-view="age" class="athlete-plot"></div><p data-filters class="athlete-active" aria-live="polite"></p></section>
    </div>
    <div class="athlete-details">
      <section aria-labelledby="sports-title"><div class="athlete-section-heading"><h3 id="sports-title">Medalist share by sport</h3><button type="button" data-all-sports>All sports</button></div><p class="athlete-caption">Select a sport · ⌘ / Ctrl-click to select several.</p><div data-ranking class="athlete-ranking"></div><nav data-sport-pages class="athlete-pages" aria-label="Sport pages"></nav><p class="athlete-caption">Blue = athletes with ≥1 medal / athletes in the sport. Team medals count per athlete.</p></section>
      <section aria-labelledby="roster-title"><div class="athlete-section-heading"><h3 id="roster-title">In this cohort</h3><span>Medalists first</span></div><div class="athlete-roster"><table><colgroup><col class="athlete-name-column"><col class="athlete-team-column"><col class="athlete-sport-column"><col class="athlete-medals-column"></colgroup><thead><tr><th>Athlete</th><th>Team</th><th>Sport</th><th>Medals</th></tr></thead><tbody></tbody></table><p data-empty class="athlete-caption athlete-empty" hidden>No athletes match these filters.</p></div><nav data-roster-pages class="athlete-pages" aria-label="Athlete pages"></nav></section>
    </div>
    <footer class="athlete-caption athlete-footer">Rio 2016 athlete records · age on 5 August 2016 · each record represents an athlete, not an event entry.</footer>`;
  const element = (selector: string) => {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Missing dashboard element: ${selector}`);
    return el;
  };
  const sex = root.querySelector<HTMLSelectElement>('select')!;
  const onSex = () => model.setSex(sex.value === 'male' || sex.value === 'female' ? sex.value : 'all');
  sex.addEventListener('change', onSex);
  const allSports = element('[data-all-sports]');
  const onAllSports = () => model.setSports([]);
  allSports.addEventListener('click', onAllSports);
  const scale = scaleLinear().domain([0, 1]).range([0, 100]);
  const ranking = select(element('[data-ranking]'));
  const summary = select(element('.athlete-summary'));
  const tbody = select(root.querySelector('tbody')!);
  const sportsPager = createPager(element('[data-sport-pages]'), 'sports', () => render());
  const rosterPager = createPager(element('[data-roster-pages]'), 'athletes', () => render());
  const render = () => {
    const stats = model.summary();
    sex.value = model.filters.sex;
    allSports.setAttribute('aria-pressed', String(model.filters.sports.length === 0));
    summary
      .selectAll<HTMLElement, { label: string; value: string }>('div')
      .data([
        { label: 'Athletes in cohort', value: number(stats.count) },
        { label: 'Teams', value: number(stats.countries) },
        { label: 'Medalists', value: number(stats.medalists) },
        { label: 'Median age', value: stats.medianAge === null ? '—' : format('.1f')(stats.medianAge) },
      ])
      .join('div')
      .call((items) => {
        items
          .selectAll('strong')
          .data((d) => [d])
          .join('strong')
          .text((d) => d.value);
        items
          .selectAll('span')
          .data((d) => [d])
          .join('span')
          .text((d) => d.label);
      });
    const bySport = new Map(model.ranking().map((row) => [row.sport, row]));
    const sportRows = model.sports.map((sport) => bySport.get(sport) ?? { sport, count: 0, medalists: 0, rate: 0 });
    const rows = ranking
      .selectAll<HTMLButtonElement, SportSummary>('button')
      .data(sportsPager.entries(sportRows), (d) => d.sport)
      .join((enter) => {
        const button = enter.append('button').attr('type', 'button').attr('class', 'athlete-sport');
        button.append('span').attr('class', 'athlete-sport-name');
        const svg = button.append('svg').attr('viewBox', '0 0 100 12').attr('aria-hidden', 'true');
        svg.append('rect').attr('width', 100).attr('height', 12).attr('fill', '#f1f1f1');
        svg.append('rect').attr('class', 'athlete-sport-bar').attr('height', 12).attr('fill', '#0070f3');
        button.append('span').attr('class', 'athlete-sport-rate');
        return button;
      });
    rows
      .attr('data-sport', (d) => d.sport)
      .attr('aria-pressed', (d) => String(model.filters.sports.includes(d.sport)))
      .attr('aria-label', (d) => `${d.sport}: ${d.medalists} medalists of ${d.count} athletes, ${percent(d.rate)}`)
      .on('click', (event: MouseEvent, d) => {
        const selected = model.filters.sports;
        model.setSports(
          event.metaKey || event.ctrlKey
            ? selected.includes(d.sport)
              ? selected.filter((sport) => sport !== d.sport)
              : [...selected, d.sport]
            : [d.sport],
        );
      })
      .order();
    rows.select('.athlete-sport-name').text((d) => d.sport);
    rows.select('.athlete-sport-bar').attr('width', (d) => scale(d.rate));
    rows.select('.athlete-sport-rate').text((d) => `${d.count ? percent(d.rate) : '—'} · ${number(d.count)}`);
    const roster = model
      .rows()
      .sort((a, b) => b.gold + b.silver + b.bronze - (a.gold + a.silver + a.bronze) || a.name.localeCompare(b.name));
    const visible = rosterPager.entries(roster);
    const slots = Array.from({ length: PAGE_SIZE }, (_, index) => visible[index] ?? null);
    tbody
      .selectAll<HTMLTableRowElement, Athlete | null>('tr')
      .data(slots)
      .join('tr')
      .attr('data-athlete-id', (row) => row?.id ?? null)
      .attr('aria-hidden', (row) => (row ? null : 'true'))
      .selectAll('td')
      .data((row) =>
        row ? [row.name, row.nationality, row.sport, String(row.gold + row.silver + row.bronze)] : ['', '', '', ''],
      )
      .join('td')
      .attr('title', (value) => value || null)
      .text((value) => value);
    element('[data-empty]').hidden = stats.count > 0;
    element('[data-missing]').textContent =
      `${number(stats.missingBody)} athletes in this cohort have incomplete height or weight records.`;
    const { sports, age, body } = model.filters;
    element('[data-filters]').textContent = [
      sports.length === 0 ? 'All sports' : sports.length === 1 ? sports[0] : `${sports.length} sports`,
      age ? `Ages ${format('.0f')(age[0])}–${format('.0f')(age[1])}` : 'All ages',
      body ? 'Body range selected' : 'All body profiles',
    ].join(' · ');
    root.dataset.ready = 'true';
  };
  render();
  const unsubscribe = model.subscribe(render);
  return {
    body: element('[data-view="body"]'),
    age: element('[data-view="age"]'),
    target(sport?: string | null) {
      return sport
        ? ([...root.querySelectorAll<HTMLElement>('[data-sport]')].find((el) => el.dataset.sport === sport) ??
            element('[data-ranking]'))
        : allSports;
    },
    sex,
    dispose() {
      unsubscribe();
      sportsPager.dispose();
      rosterPager.dispose();
      sex.removeEventListener('change', onSex);
      allSports.removeEventListener('click', onAllSports);
      ranking.selectAll('button').on('click', null);
    },
  };
}
export type Dashboard = ReturnType<typeof createDashboard>;
