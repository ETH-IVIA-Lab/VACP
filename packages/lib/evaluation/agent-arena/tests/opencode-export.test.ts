import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJobOpencodeExport } from '../src/analyze/opencode-export.ts';

async function main() {
  await testReadsCurrentMessagesExport();
  await testRejectsSessionMismatch();
  await testRejectsPartMismatch();
  console.log('opencode-export: ok');
}

async function testReadsCurrentMessagesExport() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-opencode-export-'));
  try {
    await writeMessages(tmpRoot, [
      {
        info: {
          id: 'msg_2',
          sessionID: 'ses_test',
          role: 'assistant',
          time: { created: 2000 },
        },
        parts: [
          {
            id: 'prt_2',
            sessionID: 'ses_test',
            messageID: 'msg_2',
            type: 'text',
            text: 'Final answer',
          },
        ],
      },
      {
        info: {
          id: 'msg_1',
          sessionID: 'ses_test',
          role: 'user',
          time: { created: 1000 },
        },
        parts: [
          {
            id: 'prt_1',
            sessionID: 'ses_test',
            messageID: 'msg_1',
            type: 'text',
            text: 'Question',
          },
        ],
      },
    ]);

    const result = await readJobOpencodeExport({ jobDirAbs: tmpRoot, sessionID: 'ses_test' });
    assert.deepEqual(
      result.messages.map((m) => m.id),
      ['msg_1', 'msg_2'],
    );
    assert.equal(result.counts.messages, 2);
    assert.equal(result.counts.parts, 2);
    assert.equal(result.partsByMessageID.get('msg_2')?.[0]?.text, 'Final answer');
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function testRejectsSessionMismatch() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-opencode-export-'));
  try {
    await writeMessages(tmpRoot, [
      {
        info: {
          id: 'msg_1',
          sessionID: 'ses_other',
          role: 'assistant',
        },
        parts: [],
      },
    ]);

    await assert.rejects(
      () => readJobOpencodeExport({ jobDirAbs: tmpRoot, sessionID: 'ses_test' }),
      /belongs to ses_other, expected ses_test/,
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function testRejectsPartMismatch() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-opencode-export-'));
  try {
    await writeMessages(tmpRoot, [
      {
        info: {
          id: 'msg_1',
          sessionID: 'ses_test',
          role: 'assistant',
        },
        parts: [
          {
            id: 'prt_1',
            sessionID: 'ses_test',
            messageID: 'msg_other',
            type: 'text',
          },
        ],
      },
    ]);

    await assert.rejects(
      () => readJobOpencodeExport({ jobDirAbs: tmpRoot, sessionID: 'ses_test' }),
      /does not belong to message msg_1/,
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function writeMessages(jobDir: string, messages: unknown[]) {
  await fs.writeFile(path.join(jobDir, 'messages.json'), `${JSON.stringify(messages, null, 2)}\n`);
}

void main();
