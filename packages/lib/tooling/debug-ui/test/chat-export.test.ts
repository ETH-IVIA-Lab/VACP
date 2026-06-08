import assert from 'node:assert/strict';
import test from 'node:test';

import type { UIMessage } from '@ai-sdk/react';

import { exportConversationAsMarkdown } from '../src/overlay/modules/chat/chat-export';

test('exportConversationAsMarkdown includes user text, assistant text, reasoning, and tool payloads', () => {
  const messages: UIMessage[] = [
    {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'what is selected right now?' }],
    },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Inspect widget options first.' },
        { type: 'text', text: 'I found the active menu and applied the filter.' },
        {
          type: 'tool-vacp_execute',
          toolCallId: 'call_1',
          state: 'output-available',
          input: { name: 'vgplot.set_input_value', params: { ref: 'vacp://view/input/1', value: 'Example Item' } },
          output: { ok: true, changed: true },
        },
      ],
    },
  ];

  const markdown = exportConversationAsMarkdown({
    scopeLabel: 'example-view',
    config: {
      provider: 'openai-compatible',
      providerName: 'openai-compatible',
      baseURL: 'http://localhost:8317/v1',
      apiKey: 'default',
      model: 'gpt-5.4',
    },
    messages,
    toolEvents: [
      {
        at: '2026-03-06T10:00:01.000Z',
        toolName: 'vacp_execute',
        status: 'succeeded',
        input: { name: 'vgplot.set_input_value', params: { ref: 'vacp://view/input/1', value: 'Example Item' } },
        output: { ok: true, changed: true },
      },
      {
        at: '2026-03-06T10:00:02.000Z',
        toolName: 'vacp_capabilities',
        status: 'succeeded',
        requestedInput: { refs: ['vacp://'], includeNodeData: true },
        input: { includeNodeData: false },
        inputNote: 'Normalized bare `vacp://` scope to an unscoped request.',
        output: { graph: { nodes: [], edges: [], actions: [] } },
      },
    ],
    exportedAt: '2026-03-06T10:00:00.000Z',
  });

  assert.match(markdown, /what is selected right now\?/i);
  assert.match(markdown, /I found the active menu and applied the filter\./);
  assert.match(markdown, /### Reasoning/);
  assert.match(markdown, /### Tool: vacp_execute/);
  assert.match(markdown, /## 1\. You\n\nwhat is selected right now\?/);
  assert.match(markdown, /### Tool: vacp_execute\n\n- State: `output-available`\n- Call ID: `call_1`/);
  assert.match(markdown, /```json/);
  assert.match(markdown, /Example Item/);
  assert.match(markdown, /Requested Input/);
  assert.match(markdown, /Normalized bare `vacp:\/\/` scope/i);
  assert.match(markdown, /includeNodeData\": false/i);

  const messageToolBlock = markdown.slice(
    markdown.indexOf('### Tool: vacp_execute'),
    markdown.indexOf('## Tool Event Timeline'),
  );
  assert.match(messageToolBlock, /#### Input/);
  assert.match(messageToolBlock, /#### Output/);
  assert.equal([...messageToolBlock.matchAll(/^#### Requested Input$/gm)].length, 0);

  const timelineBlock = markdown.slice(markdown.indexOf('## Tool Event Timeline'));
  assert.equal([...timelineBlock.matchAll(/^#### Requested Input$/gm)].length, 1);
});
