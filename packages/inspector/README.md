# @vacp/inspector

The VACP Inspector lets people explore visualization state, query data, run semantic actions, replay history, and interact with an agent in Chat.

```ts
import { installVacpInspector } from '@vacp/inspector';

installVacpInspector();
```

Install the Inspector in the application that exposes `window.__vacp`. The floating **VACP** control opens Graph, Data, Actions, History, Chat, Settings, and JSON views. Providers supply the capabilities and state through the shared bridge.

The Chat tool trace and Markdown export preserve the effective input sent to each tool and the original request when normalization changes it.

## Configuration

Call `installVacpInspector()` to mount the Inspector. Dispose the returned handle when the host application unmounts. Panel layout and chat preferences persist in browser storage.

Use `installVacpInspector({ globalKey: '__myVisualization' })` to connect to a different bridge key.

## Documentation

- [Inspector](../../docs/inspector/index.md)
- [Configuration](../../docs/reference/configuration.md)
- [Get started](../../docs/get-started/index.md)
