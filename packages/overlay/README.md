# @ethivia/vacp-overlay

Shows what an agent does in the page: a cursor travels to the control or mark each step changes, and a bubble beside it shows the step's sentence. The overlay renders with React into its own shadow root, so your application adds no stylesheet, and it leaves pointer events, keyboard focus, and scrolling to the person.

```bash
pnpm add @ethivia/vacp-sdk @ethivia/vacp-overlay react react-dom zod
```

`runtime` comes from `installVacpRuntime`, and `provider` and `createVegaLitePresentation` from the [Vega-Lite guide](https://docs.vacp.dev/vega-lite/):

```ts
import { createPresenceOverlay } from '@ethivia/vacp-overlay';
import { createVegaLitePresentation } from '@ethivia/vacp-vega';

const presence = createPresenceOverlay(runtime);
presence.attach(provider, createVegaLitePresentation(provider));

// On unmount:
presence.dispose();
```

Pass `replay` from `createProvenanceReplay` to let the person step back through the agent's checkpoints. `@ethivia/vacp-overlay/streamdown` renders bubble text as streamed Markdown with the optional peer [`streamdown`](https://streamdown.ai).

- [Agent presence guide](https://docs.vacp.dev/presence/)
- [`@ethivia/vacp-overlay` reference](https://docs.vacp.dev/api/overlay), with every appearance option and its default

## License

Apache-2.0. The default cursor, icons, and waiting animation adapt [agent-browser](https://github.com/vercel-labs/agent-browser) (Apache-2.0), [Tabler Icons](https://github.com/tabler/tabler-icons) (MIT), [Lucide](https://github.com/lucide-icons/lucide) (ISC), and [loading.dev](https://github.com/jakubkrehel/loading) (MIT).
