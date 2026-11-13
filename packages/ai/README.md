# @ethivia/vacp-ai

Runs an [AI SDK](https://ai-sdk.dev) agent inside the page with the VACP agent tools. The agent reads and changes the analysis through the page bridge, and each of its steps shows a sentence to the person watching.

```bash
pnpm add @ethivia/vacp-sdk @ethivia/vacp-ai ai zod @ai-sdk/openai-compatible
```

`@ai-sdk/openai-compatible` is the model provider in this example. Any AI SDK `LanguageModel` works. `baseURL` and `apiKey` name your model endpoint:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createVacpToolLoopAgent } from '@ethivia/vacp-ai';
import { getVacpBridge } from '@ethivia/vacp-sdk/agent';

const bridge = getVacpBridge();
if (!bridge) throw new Error('VACP is not installed on this page');
const model = createOpenAICompatible({ name: 'gateway', baseURL, apiKey }).chatModel('gpt-5.5');
const agent = createVacpToolLoopAgent({ model, runtime: bridge });
const { text } = await agent.generate({ prompt: 'Which cluster has the heaviest cars?' });
```

`createVacpChatTransport` returns the same agent with a chat transport for the AI SDK's `useChat`. `createVacpAgentTools(bridge)` returns the tools alone for a host that runs its own model loop.

- [Connect an agent](https://docs.vacp.dev/agents/)
- [`@ethivia/vacp-ai` reference](https://docs.vacp.dev/api/ai)

## License

Apache-2.0
