import {
  dynamicTool,
  fingerprintTools,
  generateText,
  isStepCount,
  jsonSchema,
  type ModelMessage,
  type ToolSet,
} from 'ai';

import type { AgentPage, Condition, PageTool } from '../ports';
import { browserAssistantInstructions } from './instructions';

/**
 * The catalog as AI SDK tools under their registered names, which model APIs accept as written. A
 * browser-side failure reaches the model as the tool's error.
 */
function pageTools(page: AgentPage, catalog: readonly PageTool[]): ToolSet {
  return Object.fromEntries(
    catalog.map((tool) => [
      tool.name,
      dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(tool.inputSchema),
        execute: (input) => page.callTool(tool.name, input),
      }),
    ]),
  );
}

export type WebMcpConditionOptions = {
  instructions?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

/**
 * A browser host's agent: the page's WebMCP catalog is its whole tool surface. The catalog is read
 * again before every model call, because VACP discloses actions as they become available.
 */
export function webmcpCondition(options: WebMcpConditionOptions = {}): Condition {
  const instructions = options.instructions ?? browserAssistantInstructions;
  const maxRetries = 4;
  return {
    kind: 'agent',
    async start({ model }) {
      return {
        description: {
          loop: 'AI SDK generateText, one model call per step, the WebMCP catalog read before each',
          instructions,
          tools: 'the page WebMCP catalog',
          settings: { temperature: options.temperature, maxOutputTokens: options.maxOutputTokens, maxRetries },
        },
        async conversation({ page, trace, signal, maxSteps, telemetry }) {
          const messages: ModelMessage[] = [];
          const settings = telemetry();
          return {
            async say(message) {
              messages.push({ role: 'user', content: message });
              let text = '';
              for (let step = 0; step < maxSteps; step++) {
                const tools = pageTools(page, await page.tools());
                trace.catalog(JSON.stringify(await fingerprintTools(tools)));
                const result = await generateText({
                  model: model.language,
                  instructions,
                  messages,
                  tools,
                  stopWhen: isStepCount(1),
                  abortSignal: signal,
                  maxRetries,
                  temperature: options.temperature,
                  maxOutputTokens: options.maxOutputTokens,
                  providerOptions: model.options,
                  telemetry: settings,
                });
                text = result.text;
                messages.push(...result.response.messages);
                if (result.finishReason === 'length') return { text, stop: 'length' };
                if (result.finishReason !== 'tool-calls') return { text, stop: 'done' };
              }
              return { text, stop: 'max-steps' };
            },
          };
        },
      };
    },
  };
}
