# Component frameworks

Mount the integration where the chart's element exists, and release it where the element goes away. In React, wrap the integration in an effect. `mountChart` is the function from [vega-lite.md](vega-lite.md).

```ts
import { useEffect, type RefObject } from 'react';
import type { TopLevelSpec } from 'vega-lite';

declare function mountChart(root: HTMLElement, spec: TopLevelSpec): Promise<{ dispose(): void }>;

export function useVacpChart(element: RefObject<HTMLDivElement | null>, spec: TopLevelSpec) {
  useEffect(() => {
    let released = false;
    let release: (() => void) | undefined;
    void mountChart(element.current!, spec).then((mounted) => {
      if (released) mounted.dispose();
      else release = () => mounted.dispose();
    });
    return () => {
      released = true;
      release?.();
    };
  }, [element, spec]);
}
```

- React's [StrictMode](https://react.dev/reference/react/StrictMode) runs each effect twice in development. The `released` flag disposes the first mount when `embed` resolves after the cleanup ran.
- Pass a `spec` with a stable identity, such as a module constant or a `useMemo` value. A spec rebuilt on each render remounts the chart and restarts the provider.
- In Vue, mount in `onMounted` and release in `onBeforeUnmount`. In Svelte, mount in `onMount` and return the release function.
- With server rendering, keep the mount in that browser-only hook. The packages import under Node, and `installVacpRuntime`, Vega, and Mosaic need a rendered page.

## Controlled components

When a store owns the value, point `subscribe` at the store and call the store's setter from the handler. Call `runtime.record({ actor: vacpHumanActor, message })` from the component's `onChange`, and leave the store's subscribers free of record calls. The store's subscribers also run for agent steps.

Pass the record call to the component as a callback, so the component stays free of VACP imports:

```ts
import { vacpHumanActor, type VacpRuntime } from '@ethivia/vacp-sdk';

declare const runtime: VacpRuntime;

export const onInteraction = (message: string) => void runtime.record({ actor: vacpHumanActor, message });
```

Installing twice with the same source ID replaces the first provider. Disposing one installation releases only the providers it attached, and the runtime leaves `window.__vacp` when the last provider goes.
