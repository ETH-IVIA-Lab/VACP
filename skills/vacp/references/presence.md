# Agent presence

Presence shows the person what an agent does. A cursor travels to the control or mark each step changes, and a bubble shows the agent's sentence for the step. It follows every agent call the runtime executes.

```bash
pnpm add @ethivia/vacp-overlay react react-dom
```

`@ethivia/vacp-overlay` renders into its own shadow root, so it works in a page written with any framework. The app needs `react` and `react-dom` at `^19.3.1` installed even when it renders nothing else with React.

```ts
import { createPresenceOverlay } from '@ethivia/vacp-overlay';
import type { VacpProvider, VacpRuntime } from '@ethivia/vacp-sdk';
import { createVegaLitePresentation } from '@ethivia/vacp-vega';

declare const runtime: VacpRuntime;
declare const provider: VacpProvider;

const presence = createPresenceOverlay(runtime);
presence.attach(provider, createVegaLitePresentation(provider));

// When the view unmounts:
presence.dispose();
```

`attach` tells presence where one provider's entities appear on screen, and returns a function that detaches the provider. Call `attach` once for each provider. The presentation reads the `root` the provider was created with. For vgplot, use `createVgplotPresentation(provider)` from `@ethivia/vacp-vgplot`.

## Point at your own controls

Mark the element that shows each ref with `data-vacp-ref`, and give each action a `.focus()`:

```ts
import { createPresenceOverlay } from '@ethivia/vacp-overlay';
import type { VacpProvider, VacpRuntime } from '@ethivia/vacp-sdk';
import { createRefPresentation } from '@ethivia/vacp-sdk/presence';

declare const runtime: VacpRuntime;
declare const provider: VacpProvider;

// <form id="filters"><input type="range" data-vacp-ref="vacp://sales/filters/threshold" /></form>
const filters = document.querySelector('#filters')!;
const presence = createPresenceOverlay(runtime);

presence.attach(provider, createRefPresentation(filters));
```

A step whose target cannot be found still runs. Pass `onUnplaced: (activity) => console.warn(activity)` to `createPresenceOverlay` to find those steps. When an element depends on more than the ref, pass your own lookup to `createElementPresenceResolver((focus) => element)`.

## Let the person replay the steps

Pass a replay controller, and the bubble offers back and forward arrows after a request:

```ts
import { createPresenceOverlay } from '@ethivia/vacp-overlay';
import { createProvenanceReplay, createVacpRestorer, type VacpRuntime } from '@ethivia/vacp-sdk';

declare const runtime: VacpRuntime;

const replay = createProvenanceReplay(runtime, { restore: createVacpRestorer(runtime) });
const presence = createPresenceOverlay(runtime, { replay });

// When the view unmounts:
presence.dispose();
replay.dispose();
```

Each source restores through `vacp.apply_state`. The Vega-Lite and vgplot providers register it. A custom provider needs `registerVacpApplyStateAction`, as in [custom-provider.md](custom-provider.md).

## Pace the steps

```ts
import type { AgentPresence } from '@ethivia/vacp-sdk/presence';
import { paceAgentPresence } from '@ethivia/vacp-sdk/presence';
import type { VacpRuntime } from '@ethivia/vacp-sdk';

declare const runtime: VacpRuntime;
declare const presence: AgentPresence;

const stopPacing = paceAgentPresence(runtime, presence, {
  arrivalTimeoutMs: 900,
  beforeExecuteMs: 320,
  afterExecuteMs: 1200,
});
```

Each agent step waits up to `arrivalTimeoutMs` for the cursor, pauses `beforeExecuteMs`, runs, and holds the result for `afterExecuteMs`. Only steps the overlay shows wait. Call `stopPacing()` to remove the pauses.

## Verify

Run an action with a narration through `window.__vacp.execute`, then confirm that `document.querySelector('[data-vacp-presence]')` exists and a screenshot shows the cursor at the target with the sentence beside it. The overlay's content lives in a shadow root, so query through `element.shadowRoot`.
