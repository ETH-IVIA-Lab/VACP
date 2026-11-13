// Published manifests drop the `vacp-source` export condition. It points at TypeScript sources that
// the tarballs leave out, and only the workspace's example builds enable it.
function beforePacking(manifest) {
  for (const target of Object.values(manifest.exports ?? {})) {
    if (target && typeof target === 'object') delete target['vacp-source'];
  }
  return manifest;
}

export const hooks = { beforePacking };
