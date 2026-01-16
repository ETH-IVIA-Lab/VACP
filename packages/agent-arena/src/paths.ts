import path from 'node:path';

export function resolveFromCwd(p: string) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
