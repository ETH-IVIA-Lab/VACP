import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderSessionTranscriptMarkdown, writeJobTranscript } from '../src/analyze/transcript.ts';
import type { OpencodeMessageInfo, OpencodePart } from '../src/analyze/opencode-export.ts';

async function main() {
  await testRenderIncludesConversationAndToolContext();
  await testWriteJobTranscriptWritesStatusReports();
  console.log('transcript-markdown: ok');
}

async function testRenderIncludesConversationAndToolContext() {
  const messages: OpencodeMessageInfo[] = [
    {
      id: 'msg_user',
      sessionID: 'ses_test',
      role: 'user',
      timeCreated: 1000,
    },
    {
      id: 'msg_assistant',
      sessionID: 'ses_test',
      role: 'assistant',
      timeCreated: 2000,
      timeCompleted: 2500,
    },
  ];

  const userPart: OpencodePart = {
    id: 'prt_user_text',
    sessionID: 'ses_test',
    messageID: 'msg_user',
    type: 'text',
    text: 'Use the browser and report the final result.',
  };

  const assistantReasoning: OpencodePart = {
    id: 'prt_reasoning',
    sessionID: 'ses_test',
    messageID: 'msg_assistant',
    type: 'reasoning',
    text: 'Checking the figure and then confirming the value.',
  };

  const assistantTool: OpencodePart = {
    id: 'prt_tool',
    sessionID: 'ses_test',
    messageID: 'msg_assistant',
    type: 'tool',
    tool: 'bash',
    state: {
      status: 'completed',
      title: 'Capture chart state',
      input: {
        command: 'agent-browser screenshot "step-01.png" --session ses_test',
        description: 'Capture first screenshot',
        filePath: '/secret/path/only_in_filepath.png',
        params: {
          sql: 'SELECT * FROM weather LIMIT 5',
          handleRef: 'vacp://internal/handle',
          detail: 'show columns only',
        },
        nested: {
          itemId: 'itm_hidden',
          note: 'keep nested note',
        },
      },
      output: '\u001b[32m✓\u001b[0m done',
      error: '',
    },
  };

  const assistantStepFinish = {
    id: 'prt_finish',
    sessionID: 'ses_test',
    messageID: 'msg_assistant',
    type: 'step-finish',
    reason: 'tool-calls',
  };

  const partsByMessageID = new Map<string, OpencodePart[]>();
  partsByMessageID.set('msg_user', [userPart]);
  partsByMessageID.set('msg_assistant', [assistantReasoning, assistantTool, assistantStepFinish]);

  const markdown = renderSessionTranscriptMarkdown({
    runID: 'run_test',
    jobDirRelative: 'runs/experiment=x/scenario=y/modelProvider=z/modelName=m',
    sessionID: 'ses_test',
    messages,
    partsByMessageID,
  });

  assert.equal(markdown.includes('## Message 001 (user)'), true);
  assert.equal(markdown.includes('## Message 002 (assistant)'), true);
  assert.equal(markdown.includes('### Text'), true);
  assert.equal(markdown.includes('### Reasoning'), true);
  assert.equal(markdown.includes('### Tool: `bash`'), true);
  assert.equal(markdown.includes('Capture chart state'), true);
  assert.equal(markdown.includes('Capture first screenshot'), true);
  assert.equal(markdown.includes('agent-browser screenshot "step-01.png" --session ses_test'), true);
  assert.equal(markdown.includes('SELECT * FROM weather LIMIT 5'), true);
  assert.equal(markdown.includes('show columns only'), true);
  assert.equal(markdown.includes('keep nested note'), true);
  assert.equal(markdown.includes('### Step Finish'), true);
  assert.equal(markdown.includes('reason: `tool-calls`'), true);

  assert.equal(markdown.includes('/secret/path/only_in_filepath.png'), false);
  assert.equal(markdown.includes('vacp://internal/handle'), false);
  assert.equal(markdown.includes('itm_hidden'), false);
  assert.equal(markdown.includes('\u001b['), false);
  assert.equal(markdown.includes('✓ done'), true);
}

async function testWriteJobTranscriptWritesStatusReports() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-transcript-test-'));

  try {
    const runDir = path.join(tmpRoot, 'run');
    const missingSessionJobDir = path.join(runDir, 'runs', 'job-missing-session');
    const noMessagesJobDir = path.join(runDir, 'runs', 'job-no-messages');

    await fs.mkdir(missingSessionJobDir, { recursive: true });
    await fs.mkdir(noMessagesJobDir, { recursive: true });

    const missingSessionResult = await writeJobTranscript({
      runID: 'run_test',
      runDir,
      jobDirAbs: missingSessionJobDir,
      sessionID: '',
      messages: [],
      partsByMessageID: new Map(),
    });

    assert.equal(missingSessionResult.status, 'missing_session_id');
    const missingTranscript = await fs.readFile(missingSessionResult.transcriptPath, 'utf8');
    assert.equal(missingTranscript.includes('status: `missing_session_id`'), true);

    const noMessagesResult = await writeJobTranscript({
      runID: 'run_test',
      runDir,
      jobDirAbs: noMessagesJobDir,
      sessionID: 'ses_test',
      messages: [],
      partsByMessageID: new Map(),
    });

    assert.equal(noMessagesResult.status, 'no_messages');
    const noMessagesTranscript = await fs.readFile(noMessagesResult.transcriptPath, 'utf8');
    assert.equal(noMessagesTranscript.includes('status: `no_messages`'), true);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

void main();
