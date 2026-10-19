# Olympic Athlete Explorer

Explore 11,538 Rio 2016 athletes with linked age, body-profile, sport, and sex filters.

```sh
pnpm --filter @ethivia/vacp-example-athlete-explorer dev
```

Open `https://athletes.examples.vacp.localhost`, or choose **Olympic Athlete Explorer** in the main gallery.

- Brush age in vgplot and height/weight in Vega-Lite.
- Select a sport in the D3 medalist comparison. Cmd-click (or Ctrl-click) adds or removes sports. A plain click selects one sport, and **All sports** clears the sport filter. Sports keep a fixed alphabetical order while filters change. Use the page controls to browse sports and athletes.
- Read the filtered roster, team count, medalist count, and median age.

The dataset is reused from the vgplot gallery. Age is calculated on 5 August 2016. Missing body measurements remain in the cohort until a body filter excludes them. Medalist share counts athletes with at least one medal, including team medals, rather than medals per event.

`model.ts` owns cohort filtering. `charts.ts` connects native chart selections and shares Mosaic's DuckDB connection. `app.ts` renders the custom D3 controls and summaries. `vacp.ts` builds three providers with one data handle and cross-provider graph edges, then installs them with `installExampleRuntime` from `@ethivia/vacp-example-shared`, which adds WebMCP tools and agent presence. Application linking works independently of VACP.
