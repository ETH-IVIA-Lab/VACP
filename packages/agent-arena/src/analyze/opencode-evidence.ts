import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveOpencodeStorageRoot } from './opencode-storage.js';

export type OpencodeEvidenceSnapshotArgs = {
  runDir: string;
  sessionIDs: string[];
  projectIDs?: string[];
  // Either sourceStorageDir or opencodeRoot can be provided. Both are optional because
  // an existing complete snapshot can satisfy strict mode without external storage.
  sourceStorageDir?: string;
  opencodeRoot?: string;
};

export type OpencodeEvidenceCounts = {
  requiredSessions: number;
  requiredProjects: number;
  messageFiles: number;
  partFiles: number;
  sessionFiles: number;
  sessionDiffFiles: number;
  projectFiles: number;
};

export type OpencodeEvidenceSnapshotResult = {
  runDir: string;
  evidenceDir: string;
  manifestPath: string;
  sourceStorageDir: string | null;
  sessionIDs: string[];
  projectIDs: string[];
  counts: OpencodeEvidenceCounts;
  complete: boolean;
  generatedAt: string;
};

const EVIDENCE_STORAGE_RELATIVE = path.join('evidence', 'opencode-storage');
const MANIFEST_VERSION = 1;

export async function ensureOpencodeEvidenceSnapshot(
  args: OpencodeEvidenceSnapshotArgs,
): Promise<OpencodeEvidenceSnapshotResult> {
  const runDir = path.resolve(args.runDir);
  const evidenceDir = path.join(runDir, EVIDENCE_STORAGE_RELATIVE);
  const manifestPath = path.join(evidenceDir, 'manifest.json');

  const sessionIDs = uniqueNonEmpty(args.sessionIDs);
  const projectIDs = uniqueNonEmpty(args.projectIDs ?? []);

  await fs.mkdir(evidenceDir, { recursive: true });

  const existing = await inspectEvidenceStorage({ evidenceDir, sessionIDs, projectIDs });
  if (existing.complete) {
    const existingManifest = await readJsonOptional(manifestPath);
    const existingSourceStorageDir = coerceOptionalString((existingManifest as any)?.sourceStorageDir);
    const generatedAt = new Date().toISOString();
    await writeManifest({
      manifestPath,
      runDir,
      evidenceDir,
      sourceStorageDir: existingSourceStorageDir,
      sessionIDs,
      projectIDs,
      counts: existing.counts,
      complete: true,
      generatedAt,
      missing: [],
      reusedExisting: true,
    });

    return {
      runDir,
      evidenceDir,
      manifestPath,
      sourceStorageDir: existingSourceStorageDir,
      sessionIDs,
      projectIDs,
      counts: existing.counts,
      complete: true,
      generatedAt,
    };
  }

  const sourceStorageDir = await resolveSourceStorageDir({
    sessionIDs,
    sourceStorageDir: args.sourceStorageDir,
    opencodeRoot: args.opencodeRoot,
  });

  await copyEvidenceSubset({ sourceStorageDir, evidenceDir, sessionIDs, projectIDs });

  const inspected = await inspectEvidenceStorage({ evidenceDir, sessionIDs, projectIDs });
  if (!inspected.complete) {
    const missingPreview = inspected.missing.slice(0, 40).join('\n- ');
    throw new Error(
      [
        'Opencode evidence snapshot is incomplete after copy.',
        `Run dir: ${runDir}`,
        `Source storage: ${sourceStorageDir}`,
        `Evidence dir: ${evidenceDir}`,
        `Missing (${inspected.missing.length}):`,
        `- ${missingPreview}${inspected.missing.length > 40 ? '\n- ...' : ''}`,
      ].join('\n'),
    );
  }

  const generatedAt = new Date().toISOString();
  await writeManifest({
    manifestPath,
    runDir,
    evidenceDir,
    sourceStorageDir,
    sessionIDs,
    projectIDs,
    counts: inspected.counts,
    complete: true,
    generatedAt,
    missing: [],
    reusedExisting: false,
  });

  return {
    runDir,
    evidenceDir,
    manifestPath,
    sourceStorageDir,
    sessionIDs,
    projectIDs,
    counts: inspected.counts,
    complete: true,
    generatedAt,
  };
}

async function resolveSourceStorageDir(args: {
  sessionIDs: string[];
  sourceStorageDir?: string;
  opencodeRoot?: string;
}) {
  const tried: string[] = [];

  const explicitCandidates = uniqueNonEmpty([args.sourceStorageDir ?? '', args.opencodeRoot ?? '']);
  for (const candidate of explicitCandidates) {
    tried.push(candidate);
    try {
      const root = await resolveOpencodeStorageRoot({ opencodeRoot: candidate, sessionIDs: args.sessionIDs });
      return root.storageDir;
    } catch {
      // Continue to next candidate.
    }
  }

  try {
    const root = await resolveOpencodeStorageRoot({ sessionIDs: args.sessionIDs });
    return root.storageDir;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const triedLines = tried.length ? `\nExplicit candidates tried:\n- ${tried.join('\n- ')}` : '';
    throw new Error(`Failed to resolve source Opencode storage for evidence snapshot.${triedLines}\n${msg}`);
  }
}

async function copyEvidenceSubset(args: {
  sourceStorageDir: string;
  evidenceDir: string;
  sessionIDs: string[];
  projectIDs: string[];
}) {
  const sourceStorageDir = path.resolve(args.sourceStorageDir);
  const evidenceDir = path.resolve(args.evidenceDir);

  const messageIDs = new Set<string>();

  for (const sessionID of args.sessionIDs) {
    const sourceMessageDir = path.join(sourceStorageDir, 'message', sessionID);
    const messageFiles = await listJsonFiles(sourceMessageDir);

    for (const fileName of messageFiles) {
      const messageID = fileName.replace(/\.json$/i, '');
      if (messageID) messageIDs.add(messageID);
      await copyFileIfMissing(
        path.join(sourceMessageDir, fileName),
        path.join(evidenceDir, 'message', sessionID, fileName),
      );
    }
  }

  for (const messageID of messageIDs) {
    const sourcePartDir = path.join(sourceStorageDir, 'part', messageID);
    const partFiles = await listJsonFiles(sourcePartDir);

    for (const fileName of partFiles) {
      await copyFileIfMissing(path.join(sourcePartDir, fileName), path.join(evidenceDir, 'part', messageID, fileName));
    }
  }

  const sessionFileIndex = await indexSessionFiles(path.join(sourceStorageDir, 'session'));
  for (const sessionID of args.sessionIDs) {
    const sourceSessionFile = sessionFileIndex.get(sessionID);
    if (!sourceSessionFile) continue;
    const rel = path.relative(sourceStorageDir, sourceSessionFile);
    await copyFileIfMissing(sourceSessionFile, path.join(evidenceDir, rel));
  }

  for (const sessionID of args.sessionIDs) {
    const sourceDiffFile = path.join(sourceStorageDir, 'session_diff', `${sessionID}.json`);
    if (!(await isFile(sourceDiffFile))) continue;
    await copyFileIfMissing(sourceDiffFile, path.join(evidenceDir, 'session_diff', `${sessionID}.json`));
  }

  for (const projectID of args.projectIDs) {
    const sourceProjectFile = path.join(sourceStorageDir, 'project', `${projectID}.json`);
    if (!(await isFile(sourceProjectFile))) continue;
    await copyFileIfMissing(sourceProjectFile, path.join(evidenceDir, 'project', `${projectID}.json`));
  }
}

async function inspectEvidenceStorage(args: {
  evidenceDir: string;
  sessionIDs: string[];
  projectIDs: string[];
}): Promise<{
  complete: boolean;
  missing: string[];
  counts: OpencodeEvidenceCounts;
}> {
  const evidenceDir = path.resolve(args.evidenceDir);
  const missing: string[] = [];

  const counts: OpencodeEvidenceCounts = {
    requiredSessions: args.sessionIDs.length,
    requiredProjects: args.projectIDs.length,
    messageFiles: 0,
    partFiles: 0,
    sessionFiles: 0,
    sessionDiffFiles: 0,
    projectFiles: 0,
  };

  const sessionFileIndex = await indexSessionFiles(path.join(evidenceDir, 'session'));

  const messageIDs = new Set<string>();
  const partOptionalMessageIDs = new Set<string>();
  for (const sessionID of args.sessionIDs) {
    const messageDir = path.join(evidenceDir, 'message', sessionID);
    const messageFiles = await listJsonFiles(messageDir);
    if (!messageFiles.length) {
      missing.push(`message/${sessionID}/*.json`);
    } else {
      counts.messageFiles += messageFiles.length;
      for (const fileName of messageFiles) {
        const messageID = fileName.replace(/\.json$/i, '');
        if (!messageID) continue;
        messageIDs.add(messageID);
        const messagePath = path.join(messageDir, fileName);
        const message = await readJsonOptional(messagePath);
        if (isPartOptionalAssistantErrorMessage(message)) {
          partOptionalMessageIDs.add(messageID);
        }
      }
    }

    if (sessionFileIndex.has(sessionID)) {
      counts.sessionFiles += 1;
    } else {
      missing.push(`session/**/${sessionID}.json`);
    }

    const diffFile = path.join(evidenceDir, 'session_diff', `${sessionID}.json`);
    if (await isFile(diffFile)) counts.sessionDiffFiles += 1;
  }

  for (const messageID of messageIDs) {
    const partDir = path.join(evidenceDir, 'part', messageID);
    const partFiles = await listJsonFiles(partDir);
    if (!partFiles.length) {
      if (partOptionalMessageIDs.has(messageID)) continue;
      missing.push(`part/${messageID}/*.json`);
    } else {
      counts.partFiles += partFiles.length;
    }
  }

  for (const projectID of args.projectIDs) {
    const projectFile = path.join(evidenceDir, 'project', `${projectID}.json`);
    if (await isFile(projectFile)) {
      counts.projectFiles += 1;
    } else {
      missing.push(`project/${projectID}.json`);
    }
  }

  return {
    complete: missing.length === 0,
    missing,
    counts,
  };
}

async function writeManifest(args: {
  manifestPath: string;
  runDir: string;
  evidenceDir: string;
  sourceStorageDir: string | null;
  sessionIDs: string[];
  projectIDs: string[];
  counts: OpencodeEvidenceCounts;
  complete: boolean;
  generatedAt: string;
  missing: string[];
  reusedExisting: boolean;
}) {
  const manifest = {
    version: MANIFEST_VERSION,
    generatedAt: args.generatedAt,
    runDir: args.runDir,
    evidenceDir: args.evidenceDir,
    sourceStorageDir: args.sourceStorageDir,
    complete: args.complete,
    reusedExisting: args.reusedExisting,
    sessionIDs: args.sessionIDs,
    projectIDs: args.projectIDs,
    counts: args.counts,
    missing: args.missing,
  };

  await fs.mkdir(path.dirname(args.manifestPath), { recursive: true });
  await fs.writeFile(args.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

async function readJsonOptional(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function copyFileIfMissing(source: string, target: string) {
  if (await isFile(target)) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function indexSessionFiles(sessionRoot: string) {
  const out = new Map<string, string>();
  await walk(sessionRoot, async (fullPath, ent) => {
    if (!ent.isFile() || !ent.name.endsWith('.json')) return;
    const sessionID = ent.name.replace(/\.json$/i, '');
    if (!sessionID) return;
    if (!out.has(sessionID)) out.set(sessionID, fullPath);
  });
  return out;
}

async function walk(root: string, onEntry: (fullPath: string, ent: import('node:fs').Dirent) => Promise<void>) {
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const full = path.join(root, ent.name);
    await onEntry(full, ent);
    if (ent.isDirectory()) await walk(full, onEntry);
  }
}

async function listJsonFiles(dirPath: string) {
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((ent) => ent.isFile() && ent.name.endsWith('.json'))
    .map((ent) => ent.name)
    .sort((a, b) => a.localeCompare(b));
}

async function isFile(filePath: string) {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

function uniqueNonEmpty(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function coerceOptionalString(value: string | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function isPartOptionalAssistantErrorMessage(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  if (rec.role !== 'assistant') return false;
  if (!rec.error || typeof rec.error !== 'object') return false;

  const content = rec.content;
  if (typeof content === 'string' && content.trim().length > 0) return false;
  if (Array.isArray(content) && content.length > 0) return false;

  const parts = rec.parts;
  if (Array.isArray(parts) && parts.length > 0) return false;

  return true;
}
