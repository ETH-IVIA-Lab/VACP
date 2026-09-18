# Get started

Open the [examples gallery](https://examples.vacp.dev/) and choose a visualization. Click **VACP** to open the [Inspector](../inspector/). Select a chart element or change a control, then inspect its state in Graph or JSON.

## Run locally

The JavaScript packages are currently consumed from the repository workspace. Use Node.js 24.16 or newer, Corepack, and pnpm.

```bash
git clone https://github.com/ETH-IVIA-Lab/VACP.git
cd VACP
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open `https://examples.vacp.localhost/` (or the URL Portless prints if your proxy uses another port). Each example exposes the same capabilities, state, and action contract.

Run `make docs-serve` for `https://docs.vacp.localhost/`, or `make dev-all` to start docs, the gallery, and every standalone example. See the [development guide](https://github.com/ETH-IVIA-Lab/VACP/blob/main/development_docs/contributing.md#local-urls) for commands and local names.

## Connect your visualization

- [Custom integration](../integrate/): define your own entities, state, and actions.
- [Vega-Lite](../providers/vega-lite): expose parameters and selections from a Vega view.
- [VGPlot](../providers/vgplot): expose plots, tables, and linked interactions.

Use [agent transports](../transports/) to connect an external agent or embed an agent in the page.
