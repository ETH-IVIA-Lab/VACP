import { createHash } from 'node:crypto';
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
 * Model APIs accept `[A-Za-z0-9_-]{1,64}` tool names, and WebMCP names use dots. Every host that
 * hands the catalog to such a model has to alias it, and this one aliases deterministically.
 */
export function toolAlias(name: string, limit = 64): string {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '_');
  if (safe.length <= limit) return safe;
  return `${safe.slice(0, limit - 9)}_${createHash('sha256').update(name).digest('hex').slice(0, 8)}`;
}

/** The catalog as AI SDK tools under model-safe aliases. A browser-side failure reaches the model as the tool's error. */
function pageTools(page: AgentPage, catalog: readonly PageTool[]): ToolSet {
  return Object.fromEntries(
    catalog.map((tool) => [
      toolAlias(tool.name),
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
          const names = new Map<string, string>();
          const settings = telemetry({ toolName: (alias) => names.get(alias) ?? alias });
          return {
            async say(message) {
              messages.push({ role: 'user', content: message });
              let text = '';
              for (let step = 0; step < maxSteps; step++) {
                const catalog = await page.tools();
                for (const tool of catalog) names.set(toolAlias(tool.name), tool.name);
                const tools = pageTools(page, catalog);
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
