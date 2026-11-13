# @ethivia/vacp-vega

Exposes the parameters, selections, and data of a rendered [Vega-Lite](https://vega.github.io/vega-lite/) chart as a VACP provider. Agents set parameters and selections through the chart's own [Vega view](https://vega.github.io/vega/docs/api/view/), so linked marks update as they do for a mouse interaction.

```bash
pnpm add @ethivia/vacp-sdk @ethivia/vacp-vega vega vega-lite vega-embed zod
```

The example renders the chart with [vega-embed](https://github.com/vega/vega-embed). `root` is the chart's container element and `spec` its Vega-Lite specification:

```ts
import embed from 'vega-embed';
import { installVacpRuntime } from '@ethivia/vacp-sdk';
import { createVegaLiteProvider } from '@ethivia/vacp-vega';

const { view, vgSpec } = await embed(root, spec);
const provider = createVegaLiteProvider({
  root,
  view,
  spec,
  vgSpec,
  appId: 'analysis',
  viewId: 'overview',
  vizId: 'scatter',
});
installVacpRuntime({ providers: [provider], exposeBridge: true });
```

Pass `data: { duckdb }` with a client from `@ethivia/vacp-duckdb` to let agents query the chart's data with SQL. `createVegaLitePresentation` places the chart's marks and brushes for [agent presence](https://docs.vacp.dev/presence/).

- [Vega-Lite guide](https://docs.vacp.dev/vega-lite/)
- [`@ethivia/vacp-vega` reference](https://docs.vacp.dev/api/vega)

## License

Apache-2.0
