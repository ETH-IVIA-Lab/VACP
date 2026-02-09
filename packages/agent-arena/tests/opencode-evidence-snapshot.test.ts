import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureOpencodeEvidenceSnapshot } from '../src/analyze/opencode-evidence.ts';

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-evidence-'));
  try {
    await testSuccessfulSnapshotAndIdempotentReuse(tmpRoot);
    await testStrictFailureOnMissingPart(tmpRoot);
    console.log('opencode-evidence-snapshot: ok');
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function testSuccessfulSnapshotAndIdempotentReuse(tmpRoot: string) {
  const sourceStorageDir = path.join(tmpRoot, 'source-storage');
  const runDir = path.join(tmpRoot, 'run-success');

  const sessionID = 'ses_test_success';
  const projectID = 'proj_test_success';
  const messageIDs = ['msg_a', 'msg_b'];

  await seedStorage({ sourceStorageDir, sessionID, projectID, messageIDs });

  const first = await ensureOpencodeEvidenceSnapshot({
    runDir,
    sourceStorageDir,
    sessionIDs: [sessionID],
    projectIDs: [projectID],
  });

  assert.equal(first.complete, true);
  assert.equal(first.sourceStorageDir, sourceStorageDir);

  for (const messageID of messageIDs) {
    assert.equal(
      await isFile(path.join(runDir, 'evidence', 'opencode-storage', 'message', sessionID, `${messageID}.json`)),
      true,
    );
    assert.equal(
      await isFile(path.join(runDir, 'evidence', 'opencode-storage', 'part', messageID, `prt_${messageID}.json`)),
      true,
    );
  }

  assert.equal(
    await isFile(path.join(runDir, 'evidence', 'opencode-storage', 'session', projectID, `${sessionID}.json`)),
    true,
  );
  assert.equal(await isFile(path.join(runDir, 'evidence', 'opencode-storage', 'project', `${projectID}.json`)), true);

  const manifestPath = path.join(runDir, 'evidence', 'opencode-storage', 'manifest.json');
  const manifest = (await readJson(manifestPath)) as any;
  assert.equal(manifest.complete, true);
  assert.equal(manifest.counts.messageFiles, messageIDs.length);
  assert.equal(manifest.counts.partFiles, messageIDs.length);
  assert.equal(manifest.counts.sessionFiles, 1);
  assert.equal(manifest.counts.projectFiles, 1);

  const second = await ensureOpencodeEvidenceSnapshot({
    runDir,
    sourceStorageDir: path.join(tmpRoot, 'non-existent-source'),
    sessionIDs: [sessionID],
    projectIDs: [projectID],
  });

  assert.equal(second.complete, true);
  assert.equal(second.sourceStorageDir, sourceStorageDir);
}

async function testStrictFailureOnMissingPart(tmpRoot: string) {
  const sourceStorageDir = path.join(tmpRoot, 'source-storage-missing-part');
  const runDir = path.join(tmpRoot, 'run-failure');

  const sessionID = 'ses_test_missing_part';
  const projectID = 'proj_test_missing_part';
  const messageID = 'msg_missing_part';

  await fs.mkdir(path.join(sourceStorageDir, 'message', sessionID), { recursive: true });
  await fs.mkdir(path.join(sourceStorageDir, 'part'), { recursive: true });
  await fs.mkdir(path.join(sourceStorageDir, 'session', projectID), { recursive: true });
  await fs.mkdir(path.join(sourceStorageDir, 'project'), { recursive: true });

  await writeJson(path.join(sourceStorageDir, 'message', sessionID, `${messageID}.json`), {
    id: messageID,
    sessionID,
    role: 'assistant',
  });
  await writeJson(path.join(sourceStorageDir, 'session', projectID, `${sessionID}.json`), {
    id: sessionID,
    projectID,
  });
  await writeJson(path.join(sourceStorageDir, 'project', `${projectID}.json`), { id: projectID });

  await assert.rejects(
    () =>
      ensureOpencodeEvidenceSnapshot({
        runDir,
        sourceStorageDir,
        sessionIDs: [sessionID],
        projectIDs: [projectID],
      }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return message.includes(`part/${messageID}/*.json`);
    },
  );
}

async function seedStorage(args: {
  sourceStorageDir: string;
  sessionID: string;
  projectID: string;
  messageIDs: string[];
}) {
  await fs.mkdir(path.join(args.sourceStorageDir, 'message', args.sessionID), { recursive: true });
  await fs.mkdir(path.join(args.sourceStorageDir, 'session', args.projectID), { recursive: true });
  await fs.mkdir(path.join(args.sourceStorageDir, 'session_diff'), { recursive: true });
  await fs.mkdir(path.join(args.sourceStorageDir, 'project'), { recursive: true });

  for (const messageID of args.messageIDs) {
    await writeJson(path.join(args.sourceStorageDir, 'message', args.sessionID, `${messageID}.json`), {
      id: messageID,
      sessionID: args.sessionID,
      role: 'assistant',
    });

    await fs.mkdir(path.join(args.sourceStorageDir, 'part', messageID), { recursive: true });
    await writeJson(path.join(args.sourceStorageDir, 'part', messageID, `prt_${messageID}.json`), {
      id: `prt_${messageID}`,
      sessionID: args.sessionID,
      messageID,
      type: 'text',
      text: 'ok',
    });
  }

  await writeJson(path.join(args.sourceStorageDir, 'session', args.projectID, `${args.sessionID}.json`), {
    id: args.sessionID,
    projectID: args.projectID,
  });
  await writeJson(path.join(args.sourceStorageDir, 'session_diff', `${args.sessionID}.json`), []);
  await writeJson(path.join(args.sourceStorageDir, 'project', `${args.projectID}.json`), {
    id: args.projectID,
    worktree: '/tmp/worktree',
  });
}

async function isFile(filePath: string) {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function readJson(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

void main();
