import { createDuckDbWasmClient } from '@vacp/data-duckdb';
import { exampleDuckDbBundles, mountSpecGallery } from '@vacp/example-shared';
import { loadGallery } from './gallery';
import { renderSpec } from './vacp';

export async function mount(target: HTMLElement): Promise<() => Promise<void>> {
  const duckdb = createDuckDbWasmClient({ bundles: exampleDuckDbBundles });
  const release = () => duckdb.then((client) => client.dispose());
  try {
    const unmount = await mountSpecGallery(target, {
      entries: loadGallery(),
      render: (entry, context) => renderSpec(entry, { ...context, duckdb }),
    });
    return async () => {
      await unmount();
      await release();
    };
  } catch (error) {
    await release().catch(() => {});
    throw error;
  }
}
