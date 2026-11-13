# @ethivia/vacp-vgplot

Exposes the plots, interactors, legends, inputs, and tables of a [Mosaic](https://idl.uw.edu/mosaic/) vgplot dashboard as a VACP provider. Mosaic links views through shared selections, and the provider changes those selections the way Mosaic's own interactors do, so linked views update through Mosaic's dataflow.

```bash
pnpm add @ethivia/vacp-sdk @ethivia/vacp-vgplot zod \
  @uwdata/vgplot @uwdata/mosaic-core @uwdata/mosaic-inputs @uwdata/mosaic-plot @uwdata/mosaic-sql
```

`dashboard` is the element that holds the plots, and `pickups` and `dropoffs` are vgplot plots that have rendered:

```ts
import { installVacpRuntime } from '@ethivia/vacp-sdk';
import { createVgplotProvider } from '@ethivia/vacp-vgplot';

const provider = createVgplotProvider({
  root: dashboard,
  plots: [
    { plotId: 'pickups', plot: pickups },
    { plotId: 'dropoffs', plot: dropoffs },
  ],
  appId: 'taxis',
  viewId: 'overview',
});
installVacpRuntime({ providers: [provider], exposeBridge: true });
```

Create the provider after the plots render, because Mosaic attaches interactors and legends during the first render. Install the Mosaic versions that `@uwdata/vgplot` uses, so the dashboard and the provider share one copy of each package.

Pass `data: { duckdb }` with a query client on the database Mosaic reads to let agents query it with SQL. `createVgplotPresentation` places interactors, legend entries, inputs, and table headers for [agent presence](https://docs.vacp.dev/presence/).

- [Mosaic vgplot guide](https://docs.vacp.dev/vgplot/)
- [`@ethivia/vacp-vgplot` reference](https://docs.vacp.dev/api/vgplot)

## License

Apache-2.0
